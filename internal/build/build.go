package build

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/k1LoW/mo/internal/server"
	"github.com/k1LoW/mo/internal/static"
	"github.com/k1LoW/mo/version"
)

// staticFileContent holds a file's content for static export.
type staticFileContent struct {
	Content string `json:"content"`
	BaseDir string `json:"baseDir"`
}

// staticRawAsset holds a base64-encoded raw asset (image, etc.).
type staticRawAsset struct {
	Data     string `json:"data"`     // base64-encoded
	MimeType string `json:"mimeType"` // e.g. "image/png"
}

// staticData is the full data blob embedded into the exported SPA.
type staticData struct {
	Groups    []server.Group                       `json:"groups"`
	Contents  map[string]staticFileContent         `json:"contents"`
	RawAssets map[string]map[string]staticRawAsset `json:"rawAssets"`
	Graph     server.Graph                         `json:"graph"`
	Outline   server.Outline                       `json:"outline"`
	Version   map[string]string                    `json:"version"`
}

// BuildStaticSite scans inputDir for markdown files, builds the static data,
// and writes the SPA with embedded data to outputDir.
func BuildStaticSite(inputDir, outputDir string) error {
	absInput, err := filepath.Abs(inputDir)
	if err != nil {
		return fmt.Errorf("cannot resolve input directory: %w", err)
	}
	info, err := os.Stat(absInput)
	if err != nil {
		return fmt.Errorf("input directory does not exist: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", absInput)
	}

	// Scan for markdown files
	var files []string
	err = filepath.WalkDir(absInput, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".md" || ext == ".mdx" {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("scanning input directory: %w", err)
	}

	if len(files) == 0 {
		return fmt.Errorf("no markdown files found in %s", absInput)
	}

	// Build entries with relative display paths
	entries := make([]*server.FileEntry, 0, len(files))
	for _, f := range files {
		rel, _ := filepath.Rel(absInput, f)
		entries = append(entries, &server.FileEntry{
			Name: rel,
			ID:   server.FileID(f),
			Path: f,
		})
	}

	return buildAndWrite(entries, outputDir)
}

// BuildStaticSiteFromFiles builds a static site from explicit file paths.
func BuildStaticSiteFromFiles(filePaths []string, outputDir string) error {
	if len(filePaths) == 0 {
		return fmt.Errorf("no files specified")
	}

	// Find common directory for relative path calculation
	absPaths := make([]string, 0, len(filePaths))
	for _, f := range filePaths {
		abs, err := filepath.Abs(f)
		if err != nil {
			return fmt.Errorf("cannot resolve path %s: %w", f, err)
		}
		absPaths = append(absPaths, abs)
	}

	commonDir := filepath.Dir(absPaths[0])
	for _, p := range absPaths[1:] {
		commonDir = commonPrefix(commonDir, filepath.Dir(p))
	}

	entries := make([]*server.FileEntry, 0, len(absPaths))
	for _, abs := range absPaths {
		rel, _ := filepath.Rel(commonDir, abs)
		entries = append(entries, &server.FileEntry{
			Name: rel,
			ID:   server.FileID(abs),
			Path: abs,
		})
	}

	return buildAndWrite(entries, outputDir)
}

// commonPrefix returns the longest common directory prefix of two paths.
func commonPrefix(a, b string) string {
	aParts := strings.Split(filepath.ToSlash(a), "/")
	bParts := strings.Split(filepath.ToSlash(b), "/")
	n := len(aParts)
	if len(bParts) < n {
		n = len(bParts)
	}
	var common []string
	for i := 0; i < n; i++ {
		if aParts[i] != bParts[i] {
			break
		}
		common = append(common, aParts[i])
	}
	return filepath.FromSlash(strings.Join(common, "/"))
}

func buildAndWrite(entries []*server.FileEntry, outputDir string) error {

	// Read file contents and collect raw assets
	contents := make(map[string]staticFileContent, len(entries))
	rawAssets := make(map[string]map[string]staticRawAsset)
	for _, entry := range entries {
		data, readErr := os.ReadFile(entry.Path) //nolint:gosec
		if readErr != nil {
			slog.Warn("failed to read file", "path", entry.Path, "error", readErr)
			continue
		}
		content := string(data)
		contents[entry.ID] = staticFileContent{
			Content: content,
			BaseDir: "",
		}
		assets := collectRawAssets(entry.Path, content)
		if len(assets) > 0 {
			rawAssets[entry.ID] = assets
		}
	}

	// Build graph and outline
	graph := buildGraph(entries, contents)
	outline := buildOutline(entries, contents)

	// Export group uses relative paths only
	exportGroup := server.Group{Name: "default"}
	for _, f := range entries {
		exportGroup.Files = append(exportGroup.Files, &server.FileEntry{
			Name: f.Name,
			ID:   f.ID,
			Path: f.Name,
		})
	}

	// Sanitize graph/outline paths
	for i := range graph.Nodes {
		graph.Nodes[i].Path = graph.Nodes[i].Name
	}
	for i := range outline.Files {
		outline.Files[i].Path = outline.Files[i].Name
	}

	sd := staticData{
		Groups:    []server.Group{exportGroup},
		Contents:  contents,
		RawAssets: rawAssets,
		Graph:     graph,
		Outline:   outline,
		Version: map[string]string{
			"version":  version.Version,
			"revision": version.Revision,
		},
	}

	dataJSON, err := json.Marshal(sd)
	if err != nil {
		return fmt.Errorf("marshaling static data: %w", err)
	}

	// Write SPA files to output directory
	distFS, err := fs.Sub(static.Frontend, "dist")
	if err != nil {
		return fmt.Errorf("accessing embedded frontend: %w", err)
	}

	absOutput, err := filepath.Abs(outputDir)
	if err != nil {
		return fmt.Errorf("cannot resolve output directory: %w", err)
	}

	err = fs.WalkDir(distFS, ".", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(absOutput, path), 0o755)
		}

		fileData, readErr := fs.ReadFile(distFS, path)
		if readErr != nil {
			return readErr
		}

		if path == "index.html" {
			injection := fmt.Sprintf(
				`<script>window.__MO_STATIC_DATA__=%s;</script>`,
				string(dataJSON),
			)
			fileData = bytes.Replace(
				fileData,
				[]byte("</head>"),
				[]byte(injection+"\n</head>"),
				1,
			)
			fileData = bytes.ReplaceAll(fileData, []byte(`href="/assets/`), []byte(`href="assets/`))
			fileData = bytes.ReplaceAll(fileData, []byte(`src="/assets/`), []byte(`src="assets/`))
			fileData = bytes.ReplaceAll(fileData, []byte(`href="/favicon`), []byte(`href="favicon`))
		}

		outPath := filepath.Join(absOutput, path)
		return os.WriteFile(outPath, fileData, 0o644)
	})
	if err != nil {
		return fmt.Errorf("writing output: %w", err)
	}

	fmt.Fprintf(os.Stderr, "mo: %d file(s) processed\n", len(entries))
	return nil
}

// collectRawAssets scans markdown content for image references and reads them as base64.
func collectRawAssets(filePath, content string) map[string]staticRawAsset {
	assets := make(map[string]staticRawAsset)
	baseDir := filepath.Dir(filePath)

	lines := strings.Split(content, "\n")
	for _, line := range lines {
		refs := extractAssetRefs(line)
		for _, ref := range refs {
			if _, exists := assets[ref]; exists {
				continue
			}
			absPath := filepath.Clean(filepath.Join(baseDir, ref))
			if !strings.HasPrefix(absPath, baseDir) {
				continue
			}
			data, err := os.ReadFile(absPath) //nolint:gosec
			if err != nil {
				continue
			}
			ext := filepath.Ext(absPath)
			mimeType := mime.TypeByExtension(ext)
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}
			assets[ref] = staticRawAsset{
				Data:     base64.StdEncoding.EncodeToString(data),
				MimeType: mimeType,
			}
		}
	}
	return assets
}

// extractAssetRefs extracts relative file references from a markdown line.
func extractAssetRefs(line string) []string {
	var refs []string
	for i := 0; i < len(line); i++ {
		if i+1 < len(line) && line[i] == '!' && line[i+1] == '[' {
			closeAlt := strings.Index(line[i+2:], "](")
			if closeAlt < 0 {
				continue
			}
			start := i + 2 + closeAlt + 2
			end := strings.Index(line[start:], ")")
			if end < 0 {
				continue
			}
			ref := strings.TrimSpace(line[start : start+end])
			if si := strings.Index(ref, " "); si > 0 {
				ref = ref[:si]
			}
			if isLocalAssetRef(ref) {
				refs = append(refs, ref)
			}
			i = start + end
		}
	}
	for _, marker := range []string{`src="`, `src='`} {
		idx := 0
		for {
			pos := strings.Index(line[idx:], marker)
			if pos < 0 {
				break
			}
			start := idx + pos + len(marker)
			quote := line[idx+pos+len(marker)-1]
			end := strings.IndexByte(line[start:], quote)
			if end < 0 {
				break
			}
			ref := line[start : start+end]
			if isLocalAssetRef(ref) {
				refs = append(refs, ref)
			}
			idx = start + end + 1
		}
	}
	return refs
}

func isLocalAssetRef(ref string) bool {
	if ref == "" {
		return false
	}
	if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") ||
		strings.HasPrefix(ref, "data:") || strings.HasPrefix(ref, "mailto:") {
		return false
	}
	ext := strings.ToLower(filepath.Ext(ref))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp", ".avif":
		return true
	}
	return false
}

// buildGraph builds a link graph from the given entries (standalone, no server state).
func buildGraph(entries []*server.FileEntry, contents map[string]staticFileContent) server.Graph {
	nodeMap := make(map[string]server.GraphNode, len(entries))
	for _, entry := range entries {
		nodeMap[entry.ID] = server.GraphNode{
			ID:   entry.ID,
			Name: entry.Name,
			Path: entry.Path,
		}
	}

	pathToID := make(map[string]string, len(entries))
	for _, entry := range entries {
		pathToID[entry.Path] = entry.ID
	}

	edgeMap := make(map[string]*server.GraphEdge)
	for _, entry := range entries {
		sc, ok := contents[entry.ID]
		if !ok || sc.Content == "" {
			continue
		}
		baseDir := filepath.Dir(entry.Path)
		for _, lh := range server.ExtractLinksWithHeadings(sc.Content) {
			absTarget := filepath.Clean(filepath.Join(baseDir, lh.HrefPath))
			targetID, found := pathToID[absTarget]
			if !found {
				continue
			}
			key := entry.ID + "->" + targetID
			if _, ok := edgeMap[key]; !ok {
				edgeMap[key] = &server.GraphEdge{
					From:    entry.ID,
					To:      targetID,
					Label:   strings.TrimSpace(lh.LinkText),
					Heading: strings.TrimSpace(lh.Heading),
				}
			}
		}
	}

	nodes := make([]server.GraphNode, 0, len(nodeMap))
	for _, n := range nodeMap {
		nodes = append(nodes, n)
	}
	edges := make([]server.GraphEdge, 0, len(edgeMap))
	for _, e := range edgeMap {
		edges = append(edges, *e)
	}
	return server.Graph{Nodes: nodes, Edges: edges}
}

// buildOutline builds an outline from entries (standalone, no server state).
func buildOutline(entries []*server.FileEntry, contents map[string]staticFileContent) server.Outline {
	pathToID := make(map[string]string, len(entries))
	for _, entry := range entries {
		pathToID[entry.Path] = entry.ID
	}

	var files []server.OutlineNode
	for _, entry := range entries {
		sc, ok := contents[entry.ID]
		if !ok {
			continue
		}
		headings := extractHeadingsForBuild(sc.Content, filepath.Dir(entry.Path), pathToID)
		files = append(files, server.OutlineNode{
			ID:       entry.ID,
			Name:     entry.Name,
			Path:     entry.Path,
			Headings: headings,
		})
	}
	return server.Outline{Files: files}
}

// extractHeadingsForBuild parses H1/H2 headings and resolves links within sections.
func extractHeadingsForBuild(content, baseDir string, pathToID map[string]string) []server.OutlineHeading {
	if strings.HasPrefix(content, "---") {
		if i := strings.Index(content[3:], "\n---"); i >= 0 {
			content = content[3+i+4:]
		}
	}
	matches := server.HeadingRegex.FindAllStringSubmatchIndex(content, -1)
	if len(matches) == 0 {
		return nil
	}
	var out []server.OutlineHeading
	for i, m := range matches {
		if len(m) < 6 {
			continue
		}
		hashes := content[m[2]:m[3]]
		text := strings.TrimSpace(content[m[4]:m[5]])
		if text == "" || len(hashes) > 2 || strings.HasPrefix(text, "#") {
			continue
		}
		level := len(hashes)
		sectionStart := m[1]
		sectionEnd := len(content)
		if i+1 < len(matches) {
			sectionEnd = matches[i+1][0]
		}
		section := content[sectionStart:sectionEnd]
		linkedMap := make(map[string]string)
		for _, pair := range server.ExtractMarkdownLinks(section) {
			linkText, hrefPath := pair[0], pair[1]
			absTarget := filepath.Clean(filepath.Join(baseDir, hrefPath))
			if targetID, ok := pathToID[absTarget]; ok {
				if _, exists := linkedMap[targetID]; !exists {
					linkedMap[targetID] = strings.TrimSpace(linkText)
				}
			}
		}
		linkedFiles := make([]server.OutlineLinkedFile, 0, len(linkedMap))
		ids := make([]string, 0, len(linkedMap))
		for id, label := range linkedMap {
			linkedFiles = append(linkedFiles, server.OutlineLinkedFile{FileID: id, Label: label})
			ids = append(ids, id)
		}
		out = append(out, server.OutlineHeading{
			Level:         level,
			Text:          text,
			LinkedFiles:   linkedFiles,
			LinkedFileIDs: ids,
		})
	}
	return out
}
