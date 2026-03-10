package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// GraphNode represents a node (markdown file) in the link graph.
type GraphNode struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Path  string `json:"path,omitempty"`
	Group string `json:"group,omitempty"`
}

// GraphEdge represents a link from one file to another.
type GraphEdge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label,omitempty"`
}

// Graph is the full link graph for visualization.
type Graph struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// markdownLinkRegex matches [text](url) with optional fragment in url.
// Captures: group 1 = link text, group 2 = url (path + optional #fragment).
var markdownLinkRegex = regexp.MustCompile(`\[([^\]]*)\]\(([^)]+)\)`)

// ExtractMarkdownLinks parses content and returns (linkText, hrefPath) pairs.
// hrefPath is the path part of the URL (without fragment). Only .md/.mdx are returned.
func ExtractMarkdownLinks(content string) [][2]string {
	var out [][2]string
	matches := markdownLinkRegex.FindAllStringSubmatch(content, -1)
	for _, m := range matches {
		if len(m) < 3 {
			continue
		}
		text, url := m[1], m[2]
		pathPart := url
		if i := strings.Index(url, "#"); i >= 0 {
			pathPart = url[:i]
		}
		pathPart = strings.TrimSpace(pathPart)
		if pathPart == "" {
			continue
		}
		lower := strings.ToLower(pathPart)
		if strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".mdx") {
			out = append(out, [2]string{text, pathPart})
		}
	}
	return out
}

// BuildGraph builds a link graph from the current state: nodes are all files,
// edges are markdown links [text](url) that resolve to another file in state.
func (s *State) BuildGraph() Graph {
	s.mu.RLock()
	defer s.mu.RUnlock()

	nodeMap := make(map[string]GraphNode)
	var edges []GraphEdge

	for _, g := range s.groups {
		for _, entry := range g.Files {
			nodeMap[entry.ID] = GraphNode{
				ID:    entry.ID,
				Name:  entry.Name,
				Path:  entry.Path,
				Group: g.Name,
			}
		}
	}

	for _, g := range s.groups {
		for _, entry := range g.Files {
			content, baseDir := s.fileContentLocked(entry)
			if content == "" {
				continue
			}
			for _, pair := range ExtractMarkdownLinks(content) {
				label, hrefPath := pair[0], pair[1]
				absPath := filepath.Join(baseDir, hrefPath)
				absPath = filepath.Clean(absPath)
				targetID := FileID(absPath)
				if targetEntry := s.findFileByIDLocked(targetID); targetEntry != nil {
					edges = append(edges, GraphEdge{
						From:  entry.ID,
						To:    targetID,
						Label: strings.TrimSpace(label),
					})
				}
			}
		}
	}

	nodes := make([]GraphNode, 0, len(nodeMap))
	for _, n := range nodeMap {
		nodes = append(nodes, n)
	}
	return Graph{Nodes: nodes, Edges: edges}
}

// fileContentLocked returns content and baseDir for the entry. Must hold s.mu (at least RLock).
func (s *State) fileContentLocked(entry *FileEntry) (content string, baseDir string) {
	if entry.Uploaded {
		return entry.content, ""
	}
	data, err := os.ReadFile(entry.Path) //nolint:gosec // Path is server-managed
	if err != nil {
		return "", ""
	}
	return string(data), filepath.Dir(entry.Path)
}

// findFileByIDLocked finds a file by ID. Must hold s.mu (at least RLock).
func (s *State) findFileByIDLocked(id string) *FileEntry {
	for _, g := range s.groups {
		for _, f := range g.Files {
			if f.ID == id {
				return f
			}
		}
	}
	return nil
}

func handleGraph(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		graph := state.BuildGraph()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(graph); err != nil {
			slog.Error("failed to encode graph", "error", err)
		}
	}
}

// OutlineHeading is a single H1 or H2 heading.
// LinkedFileIDs are file IDs linked from that heading's section (content until next heading).
type OutlineHeading struct {
	Level         int      `json:"level"`
	Text          string   `json:"text"`
	LinkedFileIDs []string `json:"linkedFileIds,omitempty"`
}

// OutlineNode is a file with its H1/H2 headings for the outline graph.
type OutlineNode struct {
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	Group    string           `json:"group"`
	Path     string           `json:"path,omitempty"`
	Headings []OutlineHeading `json:"headings"`
}

// Outline is the full outline (files + headings) for visualization.
type Outline struct {
	Files []OutlineNode `json:"files"`
}

// headingRegex matches # or ## at start of line; captures hashes and text. Filter ### in code.
var headingRegex = regexp.MustCompile(`(?m)^(#{1,2})\s+(.+)$`)

// extractHeadingsWithLinks parses H1/H2 headings and for each heading extracts markdown links
// from its section (content until the next heading). Resolves links to file IDs in state.
func (s *State) extractHeadingsWithLinks(content string, baseDir string) []OutlineHeading {
	if strings.HasPrefix(content, "---") {
		if i := strings.Index(content[3:], "\n---"); i >= 0 {
			content = content[3+i+4:]
		}
	}
	matches := headingRegex.FindAllStringSubmatchIndex(content, -1)
	if len(matches) == 0 {
		return nil
	}
	var out []OutlineHeading
	for i, m := range matches {
		if len(m) < 6 {
			continue
		}
		hashes := content[m[2]:m[3]]
		text := strings.TrimSpace(content[m[4]:m[5]])
		if text == "" || len(hashes) > 2 {
			continue
		}
		if strings.HasPrefix(text, "#") {
			continue
		}
		level := len(hashes)
		sectionStart := m[1]
		sectionEnd := len(content)
		if i+1 < len(matches) {
			sectionEnd = matches[i+1][0]
		}
		section := content[sectionStart:sectionEnd]
		linkedIDs := make(map[string]struct{})
		for _, pair := range ExtractMarkdownLinks(section) {
			_, hrefPath := pair[0], pair[1]
			absPath := filepath.Join(baseDir, hrefPath)
			absPath = filepath.Clean(absPath)
			targetID := FileID(absPath)
			if s.findFileByIDLocked(targetID) != nil {
				linkedIDs[targetID] = struct{}{}
			}
		}
		ids := make([]string, 0, len(linkedIDs))
		for id := range linkedIDs {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		out = append(out, OutlineHeading{
			Level:         level,
			Text:          text,
			LinkedFileIDs: ids,
		})
	}
	return out
}

// BuildOutline returns all files with their H1/H2 headings.
func (s *State) BuildOutline() Outline {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var files []OutlineNode
	for _, g := range s.groups {
		for _, entry := range g.Files {
			content, baseDir := s.fileContentLocked(entry)
			headings := s.extractHeadingsWithLinks(content, baseDir)
			files = append(files, OutlineNode{
				ID:       entry.ID,
				Name:     entry.Name,
				Group:    g.Name,
				Path:     entry.Path,
				Headings: headings,
			})
		}
	}
	return Outline{Files: files}
}

func handleOutline(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		outline := state.BuildOutline()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(outline); err != nil {
			slog.Error("failed to encode outline", "error", err)
		}
	}
}
