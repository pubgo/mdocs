import { toJpeg } from "html-to-image";
import jsPDF from "jspdf";

interface PdfExportButtonProps {
    articleRef: React.RefObject<HTMLElement | null>;
    fileName: string;
}

const PDF_MARGIN_MM = 15;
const PDF_PAGE_WIDTH_MM = 210;

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

async function waitForRenderableResources(root: HTMLElement): Promise<void> {
    const images = [...root.querySelectorAll<HTMLImageElement>("img")];
    await Promise.all(
        images.map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
            });
        }),
    );

    if (document.fonts) {
        try {
            await document.fonts.ready;
        } catch {
            // ignore font loading errors
        }
    }
}

async function exportAsSinglePagePdf(article: HTMLElement, filename: string): Promise<void> {
    await waitForRenderableResources(article);

    // html-to-image uses SVG foreignObject, so the browser's own renderer
    // handles all CSS (including @layer, Tailwind v4, etc.) — pixel-perfect.
    const dataUrl = await toJpeg(article, {
        quality: 0.92,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        style: {
            maxWidth: "none",
            margin: "0",
            overflow: "visible",
        },
    });

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load captured image"));
        img.src = dataUrl;
    });

    const contentWidthMm = PDF_PAGE_WIDTH_MM - PDF_MARGIN_MM * 2;
    const contentHeightMm = (img.height * contentWidthMm) / img.width;
    const pageHeightMm = contentHeightMm + PDF_MARGIN_MM * 2;

    const pdf = new jsPDF({
        unit: "mm",
        format: [PDF_PAGE_WIDTH_MM, pageHeightMm],
    });

    // Set PDF document title
    const docTitle = filename.replace(/\.pdf$/i, "");
    pdf.setProperties({ title: docTitle });

    pdf.addImage(dataUrl, "JPEG", PDF_MARGIN_MM, PDF_MARGIN_MM, contentWidthMm, contentHeightMm);

    // Add clickable link annotations over the image.
    // Map each <a> element's bounding rect from pixel coords to PDF mm coords.
    const articleRect = article.getBoundingClientRect();
    const scaleX = contentWidthMm / articleRect.width;
    const scaleY = contentHeightMm / articleRect.height;

    const links = article.querySelectorAll<HTMLAnchorElement>("a[href]");
    for (const a of links) {
        const href = a.getAttribute("href");
        if (!href) continue;
        // Skip anchor-only links (in-page references)
        if (href.startsWith("#")) continue;

        const absUrl = toAbsoluteUrl(href);
        // Use getClientRects for inline links that may span multiple lines
        const rects = a.getClientRects();
        for (const rect of rects) {
            const x = PDF_MARGIN_MM + (rect.left - articleRect.left) * scaleX;
            const y = PDF_MARGIN_MM + (rect.top - articleRect.top) * scaleY;
            const w = rect.width * scaleX;
            const h = rect.height * scaleY;
            if (w > 0 && h > 0) {
                pdf.link(x, y, w, h, { url: absUrl });
            }
        }
    }

    // Build PDF outline (bookmarks) from heading elements
    const headings = article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
    if (headings.length > 0) {
        // Stack tracks the last outline item at each heading level (1-6)
        const stack: { level: number; item: ReturnType<typeof pdf.outline.add> }[] = [];

        for (const heading of headings) {
            const level = parseInt(heading.tagName[1], 10);
            const title = heading.textContent?.trim();
            if (!title) continue;

            // Find parent: the most recent item with a smaller level number
            let parent: ReturnType<typeof pdf.outline.add> | null = null;
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].level < level) {
                    parent = stack[i].item;
                    break;
                }
            }

            const item = pdf.outline.add(parent, title, { pageNumber: 1 });
            // Remove deeper entries from stack
            while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                stack.pop();
            }
            stack.push({ level, item });
        }
    }

    pdf.save(filename);
}

function collectPrintableStyles(): string {
    const styles: string[] = [];
    const styleNodes = document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>("link[rel='stylesheet'], style");

    styleNodes.forEach((node) => {
        if (node.tagName.toLowerCase() === "link") {
            const link = node as HTMLLinkElement;
            if (link.href) styles.push(`<link rel="stylesheet" href="${link.href}">`);
            return;
        }
        const style = node as HTMLStyleElement;
        styles.push(`<style>${style.textContent ?? ""}</style>`);
    });

    return styles.join("\n");
}

function openPrintFallback(article: HTMLElement, filename: string): void {
    const clone = article.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("img[src]").forEach((img) => {
        const src = img.getAttribute("src");
        if (src) img.setAttribute("src", toAbsoluteUrl(src));
    });
    clone.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href");
        if (href && !href.startsWith("#")) a.setAttribute("href", toAbsoluteUrl(href));
    });

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        alert("无法打开打印窗口，请检查浏览器是否拦截了弹窗");
        return;
    }

    const printableStyles = collectPrintableStyles();
    const currentTheme = document.documentElement.getAttribute("data-theme") ?? "light";
    const htmlClass = document.documentElement.className;

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html data-theme="${currentTheme}" class="${htmlClass}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${filename}</title>
    ${printableStyles}
    <style>
      @page { size: A4; margin: 15mm; }
      html, body { margin: 0; padding: 0; }
      .markdown-body { max-width: none !important; margin: 0 !important; }
    </style>
  </head>
  <body>
    ${clone.outerHTML}
  </body>
</html>`);
    printWindow.document.close();

    printWindow.focus();
    printWindow.print();
}

export function PdfExportButton({ articleRef, fileName }: PdfExportButtonProps) {
    const handleExport = async () => {
        const article = articleRef.current;
        if (!article) return;

        const filename = fileName.endsWith(".pdf") ? fileName : `${fileName.replace(/\.(md|mdx)$/i, "")}.pdf`;

        try {
            await exportAsSinglePagePdf(article, filename);
        } catch {
            // Fallback: browser print
            openPrintFallback(article, filename);
        }
    };

    return (
        <button
            type="button"
            className="flex items-center justify-center bg-transparent border border-gh-border rounded-md p-1.5 text-gh-text-secondary cursor-pointer transition-colors duration-150 hover:bg-gh-bg-hover"
            onClick={handleExport}
            title="导出 PDF（单页，不截断）"
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
