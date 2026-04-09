package server

import (
	"archive/zip"
	"bytes"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	gmhtml "github.com/yuin/goldmark/renderer/html"
)

var mdRenderer = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithParserOptions(parser.WithAutoHeadingID()),
	goldmark.WithRendererOptions(gmhtml.WithUnsafe()),
)

func renderMarkdownToHTML(source []byte) ([]byte, error) {
	var buf bytes.Buffer
	if err := mdRenderer.Convert(source, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

const exportCSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif;line-height:1.6;color:#1f2328;background:#fff}
a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}
.page{max-width:980px;margin:0 auto;padding:2rem 1.5rem}
.layout{display:flex;min-height:100vh}
nav.sidebar{width:260px;flex-shrink:0;padding:1.5rem 1rem;border-right:1px solid #d0d7de;background:#f6f8fa;position:sticky;top:0;height:100vh;overflow-y:auto}
nav.sidebar h2{font-size:1rem;margin-bottom:1rem;color:#1f2328}
nav.sidebar ul{list-style:none}nav.sidebar li{margin-bottom:.25rem}
nav.sidebar a{display:block;padding:.25rem .5rem;border-radius:6px;font-size:.875rem;color:#636c76}
nav.sidebar a:hover,nav.sidebar a.active{background:#e1e4e8;color:#1f2328;text-decoration:none}
main.content{flex:1;max-width:980px;padding:2rem 2.5rem;overflow:auto}
article h1{font-size:2em;border-bottom:1px solid #d0d7de;padding-bottom:.3em;margin:1.5em 0 1em}
article h2{font-size:1.5em;border-bottom:1px solid #d0d7de;padding-bottom:.3em;margin:1.25em 0 .75em}
article h3{font-size:1.25em;margin:1em 0 .5em}article h4{font-size:1em;margin:1em 0 .5em}
article p{margin:.5em 0}article ul,article ol{padding-left:2em;margin:.5em 0}article li{margin:.25em 0}
article code{background:#f6f8fa;padding:.2em .4em;border-radius:6px;font-size:85%}
article pre{background:#f6f8fa;padding:1em;border-radius:6px;overflow-x:auto;margin:1em 0}
article pre code{background:none;padding:0}
article blockquote{border-left:4px solid #d0d7de;padding:0 1em;color:#636c76;margin:1em 0}
article table{border-collapse:collapse;width:100%;margin:1em 0}
article th,article td{border:1px solid #d0d7de;padding:.5em .75em}article th{background:#f6f8fa}
article img{max-width:100%}article hr{border:none;border-top:1px solid #d0d7de;margin:1.5em 0}
@media(max-width:768px){.layout{flex-direction:column}nav.sidebar{width:100%;height:auto;position:static;border-right:none;border-bottom:1px solid #d0d7de}main.content{padding:1rem}}`

func fileSlug(name string) string {
	base := strings.TrimSuffix(strings.TrimSuffix(name, ".md"), ".mdx")
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, base)
}

type exportFile struct {
	Name    string
	Slug    string
	Content []byte
}

func handleExportStatic(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		groupName := r.URL.Query().Get("group")
		if groupName == "" {
			groupName = "default"
		}

		state.mu.RLock()
		g, ok := state.groups[groupName]
		if !ok {
			state.mu.RUnlock()
			http.Error(w, "group not found", http.StatusNotFound)
			return
		}

		var files []exportFile
		for _, entry := range g.Files {
			content, _ := state.fileContentLocked(entry)
			files = append(files, exportFile{
				Name:    entry.Name,
				Slug:    fileSlug(entry.Name),
				Content: []byte(content),
			})
		}
		state.mu.RUnlock()

		if len(files) == 0 {
			http.Error(w, "no files in group", http.StatusNotFound)
			return
		}

		// Build navigation HTML
		var navItems []string
		for i, f := range files {
			htmlFile := f.Slug + ".html"
			if i == 0 {
				htmlFile = "index.html"
			}
			navItems = append(navItems, fmt.Sprintf(`<li><a href="%s">%s</a></li>`, htmlFile, html.EscapeString(f.Name)))
		}
		navHTML := strings.Join(navItems, "\n")

		// Create zip
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)

		// Add style.css
		fw, err := zw.Create("assets/style.css")
		if err != nil {
			slog.Error("export: create style.css", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if _, err := fw.Write([]byte(exportCSS)); err != nil {
			slog.Error("export: write style.css", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		// Render and add HTML files
		for i, f := range files {
			rendered, err := renderMarkdownToHTML(f.Content)
			if err != nil {
				slog.Warn("export: render markdown", "file", f.Name, "error", err)
				rendered = []byte("<p>Failed to render content.</p>")
			}

			htmlFileName := f.Slug + ".html"
			if i == 0 {
				htmlFileName = "index.html"
			}

			title := html.EscapeString(strings.TrimSuffix(strings.TrimSuffix(f.Name, ".md"), ".mdx"))
			var page string
			if len(files) == 1 {
				page = buildSinglePage(title, rendered)
			} else {
				page = buildSidebarPage(title, groupName, navHTML, rendered)
			}

			fw, err := zw.Create(htmlFileName)
			if err != nil {
				slog.Error("export: create html", "file", htmlFileName, "error", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if _, err := fw.Write([]byte(page)); err != nil {
				slog.Error("export: write html", "file", htmlFileName, "error", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
		}

		if err := zw.Close(); err != nil {
			slog.Error("export: close zip", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		fileName := groupName + "-static-site.zip"
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
		if _, err := w.Write(buf.Bytes()); err != nil {
			slog.Error("export: write response", "error", err)
		}
	}
}

func buildSinglePage(title string, body []byte) string {
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="mo static export">
<link rel="stylesheet" href="assets/style.css">
<title>`)
	b.WriteString(title)
	b.WriteString(`</title>
</head>
<body>
<div class="page">
<article>
`)
	b.Write(body)
	b.WriteString(`
</article>
</div>
</body>
</html>`)
	return b.String()
}

func buildSidebarPage(title, groupName, navHTML string, body []byte) string {
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="mo static export">
<link rel="stylesheet" href="assets/style.css">
<title>`)
	b.WriteString(title)
	b.WriteString(`</title>
</head>
<body>
<div class="layout">
<nav class="sidebar">
<h2>`)
	b.WriteString(html.EscapeString(groupName))
	b.WriteString(`</h2>
<ul>
`)
	b.WriteString(navHTML)
	b.WriteString(`
</ul>
</nav>
<main class="content">
<article>
`)
	b.Write(body)
	b.WriteString(`
</article>
</main>
</div>
</body>
</html>`)
	return b.String()
}
