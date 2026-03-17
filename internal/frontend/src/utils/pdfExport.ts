import { toJpeg } from "html-to-image";
import jsPDF from "jspdf";

const PDF_MARGIN_MM = 15;
const PDF_PAGE_WIDTH_MM = 210;

interface CapturedLinkRect {
    url: string;
    xPx: number;
    yPx: number;
    widthPx: number;
    heightPx: number;
}

interface CapturedHeading {
    level: number;
    title: string;
    topPx: number;
}

export interface PdfArticleSnapshot {
    fileName: string;
    imageDataUrl: string;
    imageWidthPx: number;
    imageHeightPx: number;
    articleWidthPx: number;
    articleHeightPx: number;
    links: CapturedLinkRect[];
    headings: CapturedHeading[];
}

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
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const waitForMermaid = async () => {
        const timeoutMs = 8000;
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const pendingCount = root.querySelectorAll("[data-mermaid-render-status='pending']").length;
            if (pendingCount === 0) {
                return;
            }
            await wait(80);
        }
    };

    const waitForImages = async () => {
        const images = [...root.querySelectorAll<HTMLImageElement>("img")];
        await Promise.all(
            images.map(async (img) => {
                const src = img.currentSrc || img.getAttribute("src") || img.src;
                if (!src) return;

                try {
                    img.loading = "eager";
                } catch {
                    // ignore if read-only in this environment
                }

                if (!img.complete || img.naturalWidth === 0) {
                    await new Promise<void>((resolve) => {
                        let done = false;
                        const finish = () => {
                            if (done) return;
                            done = true;
                            resolve();
                        };

                        img.addEventListener("load", finish, { once: true });
                        img.addEventListener("error", finish, { once: true });

                        if (!img.complete) {
                            const preloader = new Image();
                            preloader.onload = finish;
                            preloader.onerror = finish;
                            preloader.src = src;
                        }
                    });
                }

                if (typeof img.decode === "function") {
                    try {
                        await img.decode();
                    } catch {
                        // ignore decode failures
                    }
                }
            }),
        );
    };

    const waitForLayoutStable = async () => {
        const timeoutMs = 3000;
        const stableFramesTarget = 4;
        let stableFrames = 0;
        let prevHeight = root.scrollHeight;
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            await wait(80);
            const currentHeight = root.scrollHeight;
            if (Math.abs(currentHeight - prevHeight) <= 1) {
                stableFrames += 1;
                if (stableFrames >= stableFramesTarget) {
                    return;
                }
            } else {
                stableFrames = 0;
                prevHeight = currentHeight;
            }
        }
    };

    await waitForMermaid();

    await waitForImages();

    if (document.fonts) {
        try {
            await document.fonts.ready;
        } catch {
            // ignore font loading errors
        }
    }

    await waitForLayoutStable();
}

function patchOutlineRenderItems(pdf: jsPDF): void {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const outline = pdf.outline as any;
    outline.renderItems = function (this: any, node: any) {
        const getVCS = this.ctx.pdf.internal.getVerticalCoordinateString;
        const getCS = this.ctx.pdf.internal.getCoordinateString;
        for (let i = 0; i < node.children.length; i++) {
            const item = node.children[i];
            this.objStart(item);
            this.line("/Title " + this.makeString(item.title));
            this.line("/Parent " + this.makeRef(node));
            if (i > 0) this.line("/Prev " + this.makeRef(node.children[i - 1]));
            if (i < node.children.length - 1) this.line("/Next " + this.makeRef(node.children[i + 1]));
            if (item.children.length > 0) {
                this.line("/First " + this.makeRef(item.children[0]));
                this.line("/Last " + this.makeRef(item.children[item.children.length - 1]));
            }
            const count = this.count_r({ count: 0 }, item);
            if (count > 0) this.line("/Count " + count);
            if (item.options?.pageNumber) {
                const info = this.ctx.pdf.internal.getPageInfo(item.options.pageNumber);
                let yPt;
                if (item.options?.destY != null) {
                    if (typeof item.options.pageHeight === "number") {
                        const yFromBottom = Math.max(0, item.options.pageHeight - item.options.destY);
                        yPt = getCS(yFromBottom);
                    } else {
                        yPt = getVCS(item.options.destY);
                    }
                } else if (typeof item.options.pageHeight === "number") {
                    yPt = getCS(item.options.pageHeight);
                } else {
                    yPt = getVCS(0);
                }
                this.line("/Dest [" + info.objId + " 0 R /XYZ 0 " + yPt + " 0]");
            }
            this.objEnd();
        }
        for (let z = 0; z < node.children.length; z++) {
            this.renderItems(node.children[z]);
        }
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

function buildSnapshotHeadings(article: HTMLElement, articleRect: DOMRect): CapturedHeading[] {
    const headings: CapturedHeading[] = [];
    const headingEls = article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
    for (const heading of headingEls) {
        const level = parseInt(heading.tagName[1], 10);
        const title = heading.textContent?.trim();
        if (!title) continue;
        const headingRect = heading.getBoundingClientRect();
        headings.push({
            level,
            title,
            topPx: headingRect.top - articleRect.top,
        });
    }
    return headings;
}

function buildSnapshotLinks(article: HTMLElement, articleRect: DOMRect): CapturedLinkRect[] {
    const links: CapturedLinkRect[] = [];
    const linkEls = article.querySelectorAll<HTMLAnchorElement>("a[href]");
    for (const a of linkEls) {
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#")) continue;
        const absUrl = toAbsoluteUrl(href);
        const rects = a.getClientRects();
        for (const rect of rects) {
            if (rect.width <= 0 || rect.height <= 0) continue;
            links.push({
                url: absUrl,
                xPx: rect.left - articleRect.left,
                yPx: rect.top - articleRect.top,
                widthPx: rect.width,
                heightPx: rect.height,
            });
        }
    }
    return links;
}

async function captureArticleSnapshot(article: HTMLElement, fileName: string): Promise<PdfArticleSnapshot> {
    await waitForRenderableResources(article);

    const articleRect = article.getBoundingClientRect();
    const fixedWidthPx = Math.max(1, Math.round(articleRect.width));

    const imageDataUrl = await toJpeg(article, {
        quality: 0.92,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        style: {
            width: `${fixedWidthPx}px`,
            minWidth: `${fixedWidthPx}px`,
            maxWidth: `${fixedWidthPx}px`,
            margin: "0",
            overflow: "visible",
        },
    });

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load captured image"));
        img.src = imageDataUrl;
    });

    return {
        fileName,
        imageDataUrl,
        imageWidthPx: img.width,
        imageHeightPx: img.height,
        articleWidthPx: articleRect.width,
        articleHeightPx: articleRect.height,
        links: buildSnapshotLinks(article, articleRect),
        headings: buildSnapshotHeadings(article, articleRect),
    };
}

function getPageMetrics(snapshot: PdfArticleSnapshot): {
    contentWidthMm: number;
    contentHeightMm: number;
    pageHeightMm: number;
    scaleX: number;
    scaleY: number;
} {
    const contentWidthMm = PDF_PAGE_WIDTH_MM - PDF_MARGIN_MM * 2;
    const contentHeightMm = (snapshot.imageHeightPx * contentWidthMm) / snapshot.imageWidthPx;
    const pageHeightMm = contentHeightMm + PDF_MARGIN_MM * 2;

    const safeArticleWidthPx = snapshot.articleWidthPx || 1;
    const safeArticleHeightPx = snapshot.articleHeightPx || 1;

    return {
        contentWidthMm,
        contentHeightMm,
        pageHeightMm,
        scaleX: contentWidthMm / safeArticleWidthPx,
        scaleY: contentHeightMm / safeArticleHeightPx,
    };
}

function drawSnapshotOnCurrentPage(
    pdf: jsPDF,
    snapshot: PdfArticleSnapshot,
): { scaleX: number; scaleY: number } {
    const { contentWidthMm, contentHeightMm, scaleX, scaleY } = getPageMetrics(snapshot);

    pdf.addImage(snapshot.imageDataUrl, "JPEG", PDF_MARGIN_MM, PDF_MARGIN_MM, contentWidthMm, contentHeightMm);

    for (const link of snapshot.links) {
        const x = PDF_MARGIN_MM + link.xPx * scaleX;
        const y = PDF_MARGIN_MM + link.yPx * scaleY;
        const w = link.widthPx * scaleX;
        const h = link.heightPx * scaleY;
        if (w > 0 && h > 0) {
            pdf.link(x, y, w, h, { url: link.url });
        }
    }

    return { scaleX, scaleY };
}

function stripPdfLikeExtension(fileName: string): string {
    return fileName.replace(/\.(md|mdx|pdf)$/i, "");
}

function addHeadingsToOutline(
    pdf: jsPDF,
    headings: CapturedHeading[],
    pageNumber: number,
    pageHeightMm: number,
    scaleY: number,
    rootParent: unknown,
): void {
    const stack: { level: number; item: unknown }[] = [];

    for (const heading of headings) {
        const destY = PDF_MARGIN_MM + heading.topPx * scaleY;

        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }

        const parent = stack.length > 0 ? stack[stack.length - 1].item : rootParent;
        const item = pdf.outline.add(parent as never, heading.title, {
            pageNumber,
            destY,
            pageHeight: pageHeightMm,
        } as never);
        stack.push({ level: heading.level, item });
    }
}

function createPdfDocument(initialSnapshot: PdfArticleSnapshot, filename: string): jsPDF {
    const { pageHeightMm } = getPageMetrics(initialSnapshot);
    const pdf = new jsPDF({
        unit: "mm",
        format: [PDF_PAGE_WIDTH_MM, pageHeightMm],
    });

    patchOutlineRenderItems(pdf);

    const docTitle = filename.replace(/\.pdf$/i, "");
    pdf.setProperties({ title: docTitle });

    return pdf;
}

async function exportAsSinglePagePdf(article: HTMLElement, filename: string): Promise<void> {
    const snapshot = await captureArticleSnapshot(article, filename);
    const pdf = createPdfDocument(snapshot, filename);

    const { scaleY } = drawSnapshotOnCurrentPage(pdf, snapshot);
    const { pageHeightMm } = getPageMetrics(snapshot);
    addHeadingsToOutline(pdf, snapshot.headings, 1, pageHeightMm, scaleY, null);

    pdf.save(filename);
}

export async function captureArticleForMergedPdf(article: HTMLElement, fileName: string): Promise<PdfArticleSnapshot> {
    return captureArticleSnapshot(article, fileName);
}

export async function exportMergedPdfFromSnapshots(
    snapshots: PdfArticleSnapshot[],
    outputFileName: string,
): Promise<void> {
    if (snapshots.length === 0) {
        throw new Error("No snapshots to export");
    }

    const filename = toPdfFilename(outputFileName);
    const pdf = createPdfDocument(snapshots[0], filename);

    for (let i = 0; i < snapshots.length; i++) {
        const snapshot = snapshots[i];
        const pageNumber = i + 1;
        const { pageHeightMm } = getPageMetrics(snapshot);

        if (i > 0) {
            pdf.addPage([PDF_PAGE_WIDTH_MM, pageHeightMm]);
            pdf.setPage(pageNumber);
        }

        const { scaleY } = drawSnapshotOnCurrentPage(pdf, snapshot);

        const fileOutlineTitle = stripPdfLikeExtension(snapshot.fileName) || `Document ${pageNumber}`;
        const fileRootItem = pdf.outline.add(null, fileOutlineTitle, {
            pageNumber,
            destY: PDF_MARGIN_MM,
            pageHeight: pageHeightMm,
        } as never);

        addHeadingsToOutline(pdf, snapshot.headings, pageNumber, pageHeightMm, scaleY, fileRootItem);
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

export function toPdfFilename(fileName: string): string {
    if (!fileName) return "document.pdf";
    if (fileName.toLowerCase().endsWith(".pdf")) return fileName;
    return `${fileName.replace(/\.(md|mdx)$/i, "")}.pdf`;
}

export async function exportArticleAsPdf(article: HTMLElement, fileName: string): Promise<void> {
    const filename = toPdfFilename(fileName);
    try {
        await exportAsSinglePagePdf(article, filename);
    } catch {
        openPrintFallback(article, filename);
    }
}
