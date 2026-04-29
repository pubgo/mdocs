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
	From    string `json:"from"`
	To      string `json:"to"`
	Label   string `json:"label,omitempty"`
	Heading string `json:"heading,omitempty"` // H1/H2 text of the section where the link appears
}

// Graph is the full link graph for visualization.
type Graph struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// markdownLinkRegex matches [text](url) with optional fragment in url.
// Captures: group 1 = link text, group 2 = url (path + optional #fragment).
var markdownLinkRegex = regexp.MustCompile(`\[([^\]]*)\]\(([^)]+)\)`)

// LinkWithHeading holds a markdown link plus the heading of its section.
type LinkWithHeading struct {
	Heading  string
	LinkText string
	HrefPath string
}

// ExtractLinksWithHeadings parses content and returns links with their section heading.
// Links before the first H1/H2 have empty heading.
func ExtractLinksWithHeadings(content string) []LinkWithHeading {
	if strings.HasPrefix(content, "---") {
		if i := strings.Index(content[3:], "\n---"); i >= 0 {
			content = content[3+i+4:]
		}
	}
	matches := HeadingRegex.FindAllStringSubmatchIndex(content, -1)
	var out []LinkWithHeading
	if len(matches) == 0 {
		for _, pair := range ExtractMarkdownLinks(content) {
			out = append(out, LinkWithHeading{LinkText: pair[0], HrefPath: pair[1]})
		}
		return out
	}
	// Process content before first heading
	firstSectionEnd := matches[0][0]
	for _, pair := range ExtractMarkdownLinks(content[:firstSectionEnd]) {
		out = append(out, LinkWithHeading{LinkText: pair[0], HrefPath: pair[1]})
	}
	for i, m := range matches {
		if len(m) < 6 {
			continue
		}
		hashes := content[m[2]:m[3]]
		headingText := strings.TrimSpace(content[m[4]:m[5]])
		if headingText == "" || len(hashes) > 2 || strings.HasPrefix(headingText, "#") {
			continue
		}
		sectionStart := m[1]
		sectionEnd := len(content)
		if i+1 < len(matches) {
			sectionEnd = matches[i+1][0]
		}
		section := content[sectionStart:sectionEnd]
		for _, pair := range ExtractMarkdownLinks(section) {
			out = append(out, LinkWithHeading{
				Heading:  headingText,
				LinkText: pair[0],
				HrefPath: pair[1],
			})
		}
	}
	return out
}

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

	// edgeKey -> first label/heading for merge; same (from,to) keeps one edge
	edgeMap := make(map[string]*GraphEdge)
	for _, g := range s.groups {
		for _, entry := range g.Files {
			content, _ := s.fileContentLocked(entry)
			if content == "" {
				continue
			}
			baseDir := s.getBaseDirForEntry(entry, g.Name)
			for _, lh := range ExtractLinksWithHeadings(content) {
				targetEntry := s.findFileByHrefLocked(baseDir, lh.HrefPath)
				if targetEntry != nil {
					targetID := targetEntry.ID
					key := entry.ID + "->" + targetID
					if _, ok := edgeMap[key]; !ok {
						edgeMap[key] = &GraphEdge{
							From:    entry.ID,
							To:      targetID,
							Label:   strings.TrimSpace(lh.LinkText),
							Heading: strings.TrimSpace(lh.Heading),
						}
					}
				}
			}
		}
	}
	for _, e := range edgeMap {
		edges = append(edges, *e)
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

// findFileByHrefLocked resolves hrefPath to a file. When baseDir is non-empty, uses
// filepath.Join(baseDir, hrefPath) and looks up by FileID. When baseDir is empty
// (e.g. uploaded file), falls back to matching by path suffix.
func (s *State) findFileByHrefLocked(baseDir, hrefPath string) *FileEntry {
	if baseDir != "" {
		absPath := filepath.Clean(filepath.Join(baseDir, hrefPath))
		return s.findFileByIDLocked(FileID(absPath))
	}
	// Fallback: match by path suffix (e.g. "other.md" or "docs/other.md")
	hrefNorm := filepath.ToSlash(filepath.Clean(hrefPath))
	var match *FileEntry
	for _, g := range s.groups {
		for _, f := range g.Files {
			if f.Uploaded || f.Path == "" {
				continue
			}
			pathNorm := filepath.ToSlash(f.Path)
			if pathNorm == hrefNorm || strings.HasSuffix(pathNorm, "/"+hrefNorm) {
				if match != nil {
					return nil // ambiguous
				}
				match = f
			}
		}
	}
	return match
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

// OutlineLinkedFile is a file linked from a heading section, with optional link text.
type OutlineLinkedFile struct {
	FileID string `json:"fileId"`
	Label  string `json:"label,omitempty"` // link text from [text](url), empty if none
}

// OutlineHeading is a single H1 or H2 heading.
// LinkedFiles are files linked from that heading's section, with link labels.
// LinkedFileIDs is deprecated, use LinkedFiles for full data.
type OutlineHeading struct {
	Level         int                 `json:"level"`
	Text          string              `json:"text"`
	LinkedFiles   []OutlineLinkedFile `json:"linkedFiles,omitempty"`
	LinkedFileIDs []string            `json:"linkedFileIds,omitempty"` // kept for backward compat
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

// HeadingRegex matches # or ## at start of line; captures hashes and text. Filter ### in code.
var HeadingRegex = regexp.MustCompile(`(?m)^(#{1,2})\s+(.+)$`)

// extractHeadingsWithLinks parses H1/H2 headings and for each heading extracts markdown links
// from its section (content until the next heading). Resolves links to file IDs in state.
func (s *State) extractHeadingsWithLinks(content string, baseDir string) []OutlineHeading {
	if strings.HasPrefix(content, "---") {
		if i := strings.Index(content[3:], "\n---"); i >= 0 {
			content = content[3+i+4:]
		}
	}
	matches := HeadingRegex.FindAllStringSubmatchIndex(content, -1)
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
		linkedMap := make(map[string]string) // fileID -> first link label
		for _, pair := range ExtractMarkdownLinks(section) {
			linkText, hrefPath := pair[0], pair[1]
			if target := s.findFileByHrefLocked(baseDir, hrefPath); target != nil {
				if _, ok := linkedMap[target.ID]; !ok {
					linkedMap[target.ID] = strings.TrimSpace(linkText)
				}
			}
		}
		linkedFiles := make([]OutlineLinkedFile, 0, len(linkedMap))
		ids := make([]string, 0, len(linkedMap))
		for id, label := range linkedMap {
			linkedFiles = append(linkedFiles, OutlineLinkedFile{FileID: id, Label: label})
			ids = append(ids, id)
		}
		sort.Slice(linkedFiles, func(i, j int) bool { return linkedFiles[i].FileID < linkedFiles[j].FileID })
		sort.Strings(ids)
		out = append(out, OutlineHeading{
			Level:         level,
			Text:          text,
			LinkedFiles:   linkedFiles,
			LinkedFileIDs: ids,
		})
	}
	return out
}

// getBaseDirForEntry returns the base directory for resolving relative links.
// For non-uploaded files, uses the file's directory. For uploaded files (baseDir empty),
// uses the directory of the first non-uploaded file in the same group as fallback.
func (s *State) getBaseDirForEntry(entry *FileEntry, groupName string) string {
	_, baseDir := s.fileContentLocked(entry)
	if baseDir != "" {
		return baseDir
	}
	// Uploaded file: use fallback from group's first file with a path
	for _, f := range s.groups[groupName].Files {
		if !f.Uploaded && f.Path != "" {
			return filepath.Dir(f.Path)
		}
	}
	return ""
}

// BuildOutline returns all files with their H1/H2 headings.
func (s *State) BuildOutline() Outline {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var files []OutlineNode
	for _, g := range s.groups {
		for _, entry := range g.Files {
			content, _ := s.fileContentLocked(entry)
			baseDir := s.getBaseDirForEntry(entry, g.Name)
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
