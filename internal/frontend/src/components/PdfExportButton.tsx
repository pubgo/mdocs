import html2canvas from "html2canvas";
import jsPDF from "jspdf";

interface PdfExportButtonProps {
  articleRef: React.RefObject<HTMLElement | null>;
  fileName: string;
}

const MARGIN = 15; // 左右上下边距 mm

function toAbsoluteUrl(href: string): string {
  if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
    return href;
  }
  try {
    return new URL(href, window.location.origin).href;
  } catch {
    return href;
  }
}

export function PdfExportButton({ articleRef, fileName }: PdfExportButtonProps) {
  const handleExport = async () => {
    const article = articleRef.current;
    if (!article) return;

    const filename = fileName.endsWith(".pdf") ? fileName : `${fileName.replace(/\.(md|mdx)$/i, "")}.pdf`;

    try {
      // 克隆并修改链接颜色，使 PDF 中更醒目
      const clone = article.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("img[src]").forEach((img) => {
        const src = img.getAttribute("src");
        if (src) img.setAttribute("src", toAbsoluteUrl(src));
      });
      clone.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href");
        if (href && !href.startsWith("#")) a.setAttribute("href", toAbsoluteUrl(href));
      });
      const linkStyle = document.createElement("style");
      linkStyle.textContent =
        "a[href^='http'] { color: #0550ae !important; text-decoration: underline !important; }";
      clone.appendChild(linkStyle);
      const wrapper = document.createElement("div");
      wrapper.style.cssText =
        "position:fixed;top:0;left:0;width:210mm;max-width:100%;z-index:-9999;opacity:0.01;pointer-events:none;background:#fff;";
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const articleRect = clone.getBoundingClientRect();
      const contentWidth = 210 - 2 * MARGIN;
      const scaleX = contentWidth / clone.offsetWidth;
      const scaleY = (canvas.height * contentWidth) / canvas.width / clone.offsetHeight;
      const headingsData = [...clone.querySelectorAll<HTMLHeadingElement>("h1, h2, h3")].map((h) => ({
        level: parseInt(h.tagName[1], 10) - 1,
        title: h.textContent?.trim() || "",
      }));
      const linksData = [...clone.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .filter((a) => {
          const href = a.getAttribute("href");
          if (!href || href.startsWith("#")) return false;
          const url = toAbsoluteUrl(href);
          return url.startsWith("http://") || url.startsWith("https://");
        })
        .map((a) => {
          const rect = a.getBoundingClientRect();
          return {
            url: toAbsoluteUrl(a.getAttribute("href")!),
            x: rect.left - articleRect.left,
            y: rect.top - articleRect.top,
            w: rect.width,
            h: rect.height,
          };
        });
      wrapper.remove();

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pageWidth = 210; // A4 宽度 mm
      const contentHeight = (canvas.height * contentWidth) / canvas.width;
      const pageHeight = contentHeight + 2 * MARGIN; // 单页不分页

      const pdf = new jsPDF({ unit: "mm", format: [pageWidth, pageHeight] });
      pdf.addImage(imgData, "JPEG", MARGIN, MARGIN, contentWidth, contentHeight);

      // 提取标题并添加 PDF 书签（大纲）
      const parentStack: (unknown | null)[] = [null, null, null];
      headingsData.forEach(({ level, title }) => {
        if (!title) return;
        const parent = level > 0 ? parentStack[level - 1] : null;
        const item = pdf.outline.add(parent, title, { pageNumber: 1 });
        parentStack[level] = item;
        for (let i = level + 1; i < 3; i++) parentStack[i] = null;
      });

      // 添加可点击链接
      linksData.forEach(({ url, x, y, w, h }) => {
        if (w > 0 && h > 0) {
          pdf.link(MARGIN + x * scaleX, MARGIN + y * scaleY, w * scaleX, h * scaleY, { url });
        }
      });

      pdf.save(filename);
    } catch {
      alert("导出失败，请尝试使用浏览器打印（Ctrl/Cmd+P）另存为 PDF");
    }
  };

  return (
    <button
      type="button"
      className="flex items-center justify-center bg-transparent border border-gh-border rounded-md p-1.5 text-gh-text-secondary cursor-pointer transition-colors duration-150 hover:bg-gh-bg-hover"
      onClick={handleExport}
      title="导出 PDF（完整内容，不截断）"
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
