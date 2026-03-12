interface PdfExportButtonProps {
  articleRef: React.RefObject<HTMLElement | null>;
  fileName: string;
}

function toAbsoluteUrl(href: string): string {
  if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("data:")) {
    return href;
  }
  try {
    return new URL(href, window.location.origin).href;
  } catch {
    return href;
  }
}

export function PdfExportButton({ articleRef, fileName }: PdfExportButtonProps) {
  const handleExport = () => {
    const article = articleRef.current;
    if (!article) return;

    const clone = article.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (src) img.setAttribute("src", toAbsoluteUrl(src));
    });
    clone.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href && !href.startsWith("#")) a.setAttribute("href", toAbsoluteUrl(href));
    });
    clone.querySelectorAll("button").forEach((btn) => btn.remove());

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fileName)}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.0/github-markdown.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
  <style>
    body { margin: 0; padding: 24px; background: #fff; color: #1f2328; }
    .markdown-body { max-width: 980px; margin: 0 auto; box-sizing: border-box; }
    .markdown-body pre, .markdown-body table, .markdown-body .markdown-alert,
    .markdown-body .katex-display, .markdown-body .overflow-x-auto { page-break-inside: avoid; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3 { page-break-after: avoid; }
    @media print {
      body { padding: 0; background: #fff; }
      .markdown-body { max-width: none; }
    }
  </style>
</head>
<body>
  <article class="markdown-body">
    ${clone.innerHTML}
  </article>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) {
      alert("请允许弹窗以导出 PDF");
      return;
    }
    win.document.write(html);
    win.document.close();

    win.onload = () => {
      win.focus();
      setTimeout(() => {
        win.print();
        win.onafterprint = () => win.close();
      }, 300);
    };
  };

  return (
    <button
      type="button"
      className="flex items-center justify-center bg-transparent border border-gh-border rounded-md p-1.5 text-gh-text-secondary cursor-pointer transition-colors duration-150 hover:bg-gh-bg-hover"
      onClick={handleExport}
      title="导出 PDF（打印对话框中选择「另存为 PDF」）"
      aria-label="Export PDF"
    >
      <svg
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      </svg>
    </button>
  );
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
