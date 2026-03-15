import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import { rehypeGithubAlerts } from "rehype-github-alerts";
import "katex/dist/katex.min.css";
import { codeToHtml } from "shiki";
import mermaid from "mermaid";
import { fetchFileContent, openRelativeFile } from "../hooks/useApi";
import { RawToggle } from "./RawToggle";
import { TocToggle } from "./TocToggle";
import { CopyButton } from "./CopyButton";
import { PdfExportButton } from "./PdfExportButton";
import { RemoveButton } from "./RemoveButton";
import { resolveLink, resolveImageSrc, extractLanguage } from "../utils/resolve";
import { parseFrontmatter } from "../utils/frontmatter";
import { stripMdxSyntax } from "../utils/mdx";
import type { TocHeading } from "./TocPanel";
import type { Components } from "react-markdown";
import "github-markdown-css/github-markdown.css";

interface MarkdownViewerProps {
  fileId: string;
  fileName: string;
  revision: number;
  onFileOpened: (fileId: string) => void;
  onHeadingsChange: (headings: TocHeading[]) => void;
  onContentRendered?: () => void;
  isTocOpen: boolean;
  onTocToggle: () => void;
  onRemoveFile: () => void;
  isWide: boolean;
}

function getMermaidTheme(): "dark" | "default" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
}

let mermaidCounter = 0;
let mermaidQueue: Promise<void> = Promise.resolve();
const MERMAID_MIN_ZOOM = 0.5;
const MERMAID_MAX_ZOOM = 10;
const MERMAID_ZOOM_STEP = 0.1;

function estimateMermaidComplexity(code: string): number {
  const lines = code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
  const edgeTokens = (code.match(/-->|==>|-.->|---|~~~|<-->/g) ?? []).length;
  const nodeTokens = (code.match(/\[[^\]]+\]|\([^\)]+\)|\{[^\}]+\}/g) ?? []).length;
  return lines + edgeTokens * 2 + nodeTokens;
}

function getMermaidRenderScale(complexity: number, isFullscreen: boolean): number {
  if (!isFullscreen) {
    if (complexity >= 260) return 0.72;
    if (complexity >= 180) return 0.8;
    if (complexity >= 120) return 0.88;
    if (complexity >= 70) return 0.94;
    return 1;
  }
  if (complexity >= 220) return 2.4;
  if (complexity >= 140) return 2.0;
  if (complexity >= 80) return 1.6;
  if (complexity >= 40) return 1.3;
  return 1;
}

function getDefaultFullscreenZoom(complexity: number): number {
  if (complexity >= 220) return 2.0;
  if (complexity >= 140) return 1.7;
  if (complexity >= 80) return 1.4;
  if (complexity >= 40) return 1.2;
  return 1;
}

function cleanupMermaidErrors() {
  document.querySelectorAll("[id^='dmermaid-']").forEach((el) => el.remove());
}

function normalizeMermaidSvg(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") {
      return svg;
    }

    const widthAttr = svgEl.getAttribute("width");
    const heightAttr = svgEl.getAttribute("height");
    const viewBox = svgEl.getAttribute("viewBox");

    if (!viewBox && widthAttr && heightAttr) {
      const width = parseFloat(widthAttr);
      const height = parseFloat(heightAttr);
      if (width > 0 && height > 0) {
        svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
      }
    }

    const prevStyle = svgEl.getAttribute("style") || "";
    const normalizedStyle = "width:100%;height:auto;max-width:100%;";

    svgEl.setAttribute("preserveAspectRatio", "xMinYMin meet");
    svgEl.setAttribute("width", "100%");
    svgEl.removeAttribute("height");
    svgEl.setAttribute("style", prevStyle ? `${prevStyle};${normalizedStyle}` : normalizedStyle);

    return new XMLSerializer().serializeToString(svgEl);
  } catch {
    return svg;
  }
}

async function renderMermaid(code: string, width?: number): Promise<string> {
  let resolve: (svg: string) => void;
  let reject: (err: unknown) => void;
  const result = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  mermaidQueue = mermaidQueue.then(async () => {
    const id = `mermaid-${++mermaidCounter}`;
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    container.style.width = `${width && width > 0 ? width : 800}px`;
    document.body.appendChild(container);
    try {
      const { svg } = await mermaid.render(id, code, container);
      resolve!(svg);
    } catch (err) {
      reject!(err);
    } finally {
      container.remove();
      cleanupMermaidErrors();
    }
  });

  return result;
}

export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const mermaidComplexity = useMemo(() => estimateMermaidComplexity(code), [code]);
  const defaultFullscreenZoom = useMemo(
    () => getDefaultFullscreenZoom(mermaidComplexity),
    [mermaidComplexity],
  );
  const blockRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const prevFullscreenRef = useRef(false);

  const clampZoom = useCallback(
    (nextZoom: number) => Math.max(MERMAID_MIN_ZOOM, Math.min(MERMAID_MAX_ZOOM, nextZoom)),
    [],
  );

  const updateZoom = useCallback(
    (delta: number) => {
      setZoom((prev) => clampZoom(prev + delta));
    },
    [clampZoom],
  );

  const resetView = useCallback(() => {
    setZoom(isFullscreen ? defaultFullscreenZoom : 1);
    setPan({ x: 0, y: 0 });
  }, [defaultFullscreenZoom, isFullscreen]);

  const handleFullscreenToggle = useCallback(async () => {
    const block = blockRef.current;
    if (!block) return;

    try {
      if (document.fullscreenElement === block) {
        await document.exitFullscreen?.();
        return;
      }
      await block.requestFullscreen?.();
    } catch {
      // Fullscreen API may fail depending on browser or context
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === blockRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (isFullscreen && !prevFullscreenRef.current) {
      setZoom(defaultFullscreenZoom);
      setPan({ x: 0, y: 0 });
    }
    if (!isFullscreen && prevFullscreenRef.current) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
    prevFullscreenRef.current = isFullscreen;
  }, [defaultFullscreenZoom, isFullscreen]);

  const handleSurfaceWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!isFullscreen) return;
      e.preventDefault();
      updateZoom(e.deltaY > 0 ? -MERMAID_ZOOM_STEP : MERMAID_ZOOM_STEP);
    },
    [isFullscreen, updateZoom],
  );

  const handleSurfaceMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isFullscreen || e.button !== 0) return;
      e.preventDefault();
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [isFullscreen, pan.x, pan.y],
  );

  const handleSurfaceMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isFullscreen || !panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
    },
    [isFullscreen],
  );

  const handleSurfaceMouseUp = useCallback(() => {
    panStartRef.current = null;
  }, []);

  const resolveRenderWidth = useCallback(() => {
    const container = containerRef.current;
    const markdownBody = container?.closest(".markdown-body") as HTMLElement | null;

    const widthCandidates = [
      container?.clientWidth,
      container?.offsetWidth,
      container?.parentElement?.clientWidth,
      markdownBody?.clientWidth,
      isFullscreen ? window.innerWidth - 48 : undefined,
    ];

    const width = widthCandidates.find((candidate): candidate is number => {
      return typeof candidate === "number" && candidate > 0;
    });

    const baseWidth = width ?? 800;
    const scale = getMermaidRenderScale(mermaidComplexity, isFullscreen);
    const scaledWidth = Math.round(baseWidth * scale);
    if (isFullscreen) {
      const maxWidth = Math.max(window.innerWidth * 6, baseWidth);
      return Math.max(baseWidth, Math.min(scaledWidth, maxWidth));
    }

    const minWidth = Math.max(280, Math.round(baseWidth * 0.55));
    return Math.min(baseWidth, Math.max(minWidth, scaledWidth));
  }, [isFullscreen, mermaidComplexity]);

  useEffect(() => {
    let cancelled = false;

    const doRender = () => {
      const width = resolveRenderWidth();
      mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
      renderMermaid(code, width)
        .then((renderedSvg) => {
          if (!cancelled) setSvg(normalizeMermaidSvg(renderedSvg));
        })
        .catch(() => {
          if (!cancelled) setSvg("");
        });
    };

    doRender();

    // Re-render on theme change
    const observer = new MutationObserver(() => doRender());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => doRender())
        : null;
    if (resizeObserver && containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      cancelled = true;
      observer.disconnect();
      resizeObserver?.disconnect();
    };
  }, [code, isFullscreen, resolveRenderWidth]);

  if (svg) {
    const canvasStyle = isFullscreen
      ? {
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: "center center",
      }
      : {
        width: "100%",
        maxWidth: "100%",
        transformOrigin: "top left",
      };

    return (
      <div ref={blockRef} className="relative group mermaid-block">
        <div
          ref={containerRef}
          data-testid="mermaid-interaction-surface"
          className={`mermaid-render ${isFullscreen ? "mermaid-render--interactive cursor-grab active:cursor-grabbing select-none" : "overflow-x-auto"}`}
          onWheel={handleSurfaceWheel}
          onMouseDown={handleSurfaceMouseDown}
          onMouseMove={handleSurfaceMouseMove}
          onMouseUp={handleSurfaceMouseUp}
          onMouseLeave={handleSurfaceMouseUp}
        >
          <div
            data-testid="mermaid-pan-canvas"
            className="mermaid-canvas"
            style={canvasStyle}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        {isFullscreen && (
          <MermaidZoomControls
            zoom={zoom}
            onZoomIn={() => updateZoom(MERMAID_ZOOM_STEP)}
            onZoomOut={() => updateZoom(-MERMAID_ZOOM_STEP)}
            onReset={resetView}
          />
        )}
        <MermaidImageCopyButton svg={svg} />
        <MermaidFullscreenButton
          isFullscreen={isFullscreen}
          onToggle={() => void handleFullscreenToggle()}
        />
        <CodeBlockCopyButton code={code} themed />
      </div>
    );
  }
  return (
    <div ref={containerRef} className="relative group">
      <pre>
        <code>{code}</code>
      </pre>
      <CodeBlockCopyButton code={code} />
    </div>
  );
}

function MermaidZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md border border-gh-border bg-gh-bg-secondary/90 p-1 backdrop-blur-xs">
      <button
        className={`flex items-center justify-center rounded-md p-1 cursor-pointer transition-all duration-150 border ${themedButtonStyle}`}
        onClick={onZoomOut}
        title="Zoom out"
      >
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 7.25a.75.75 0 0 0 0 1.5h10a.75.75 0 0 0 0-1.5z" />
        </svg>
      </button>
      <button
        className={`flex items-center justify-center rounded-md p-1 cursor-pointer transition-all duration-150 border ${themedButtonStyle}`}
        onClick={onZoomIn}
        title="Zoom in"
      >
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2.25a.75.75 0 0 1 .75.75v4.25H13a.75.75 0 0 1 0 1.5H8.75V13a.75.75 0 0 1-1.5 0V8.75H3a.75.75 0 0 1 0-1.5h4.25V3A.75.75 0 0 1 8 2.25" />
        </svg>
      </button>
      <button
        className={`flex items-center justify-center rounded-md p-1 cursor-pointer transition-all duration-150 border ${themedButtonStyle}`}
        onClick={onReset}
        title="Reset view"
      >
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2.5a5.5 5.5 0 1 1-5.18 7.347.75.75 0 0 1 1.414-.507A4 4 0 1 0 4.78 5.166L6.22 6.61a.75.75 0 0 1-1.06 1.06L2.53 5.04a.75.75 0 0 1 0-1.06L5.16 1.35a.75.75 0 1 1 1.06 1.06L4.84 3.79A5.48 5.48 0 0 1 8 2.5" />
        </svg>
      </button>
      <span
        className="px-2 text-xs text-gh-text-secondary tabular-nums min-w-12 text-center"
        title="Zoom level"
      >
        {Math.round(zoom * 100)}%
      </span>
    </div>
  );
}

function MermaidFullscreenButton({
  isFullscreen,
  onToggle,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`absolute right-[4.5rem] top-2 flex items-center justify-center rounded-md p-1 cursor-pointer transition-all duration-150 border ${themedButtonStyle} ${isFullscreen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      onClick={onToggle}
      title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
    >
      {isFullscreen ? (
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 2a.75.75 0 0 1 0 1.5H3.5V6a.75.75 0 0 1-1.5 0V2zm10 0v4a.75.75 0 0 1-1.5 0V3.5H10A.75.75 0 0 1 10 2zM2 10a.75.75 0 0 1 1.5 0v2.5H6a.75.75 0 0 1 0 1.5H2zm13.25-.75A.75.75 0 0 1 16 10v4h-4a.75.75 0 0 1 0-1.5h2.5V10a.75.75 0 0 1 .75-.75" />
        </svg>
      ) : (
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2.75 1A.75.75 0 0 1 3.5 1.75V4.5h2.75a.75.75 0 0 1 0 1.5H2V1.75A.75.75 0 0 1 2.75 1m10.5 0a.75.75 0 0 1 .75.75V6h-4.25a.75.75 0 0 1 0-1.5H12.5V1.75a.75.75 0 0 1 .75-.75M2 10h4.25a.75.75 0 0 1 0 1.5H3.5v2.75a.75.75 0 0 1-1.5 0zm12 0v4.25a.75.75 0 0 1-1.5 0V11.5H9.75a.75.75 0 0 1 0-1.5z" />
        </svg>
      )}
    </button>
  );
}

function MermaidImageCopyButton({ svg }: { svg: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      const blob = await svgToPngBlob(svg);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
    } catch {
      // clipboard API may fail in insecure contexts
    }
  };

  return (
    <button
      className={`absolute right-10 top-2 flex items-center justify-center rounded-md p-1 cursor-pointer transition-all duration-150 border ${themedButtonStyle} ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      onClick={handleCopy}
      title="Copy image"
    >
      {copied ? (
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      ) : (
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M16 13.25A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75ZM1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Z" />
          <path
            d="M0.5 12.75 4.5 5.5 7.5 9 9.5 6.5 15.5 12.75"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function svgToPngBlob(svgString: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const svgEl = doc.documentElement;

    // Ensure xmlns is present for standalone SVG rendering
    if (!svgEl.getAttribute("xmlns")) {
      svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    // Extract dimensions from the SVG element
    const widthAttr = svgEl.getAttribute("width");
    const heightAttr = svgEl.getAttribute("height");
    const viewBox = svgEl.getAttribute("viewBox");

    let width = 0;
    let height = 0;

    if (widthAttr && heightAttr) {
      width = parseFloat(widthAttr);
      height = parseFloat(heightAttr);
    } else if (viewBox) {
      const parts = viewBox.split(/[\s,]+/);
      width = parseFloat(parts[2]);
      height = parseFloat(parts[3]);
    }

    if (!width || !height) {
      reject(new Error("Cannot determine SVG dimensions"));
      return;
    }

    // Scale up for high-DPI displays
    const scale = 4;
    const serializer = new XMLSerializer();
    const svgData = serializer.serializeToString(svgEl);
    const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create PNG blob"));
        }
      }, "image/png");
    };
    img.onerror = () => {
      reject(new Error("Failed to load SVG image"));
    };
    img.src = dataUrl;
  });
}

const darkButtonStyle = "border-[#484f58] hover:border-[#8b949e] text-[#8b949e] bg-[#2d333b]";
const themedButtonStyle =
  "border-gh-border hover:border-gh-text-secondary text-gh-text-secondary bg-gh-bg-secondary";

function CodeBlockCopyButton({ code, themed = false }: { code: string; themed?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // clipboard API may fail in insecure contexts
    }
  };

  const colorStyle = themed ? themedButtonStyle : darkButtonStyle;

  return (
    <button
      className={`absolute right-2 top-2 flex items-center justify-center rounded-md p-1 cursor-pointer transition-all duration-150 border ${colorStyle} ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      onClick={handleCopy}
      title="Copy code"
    >
      {copied ? (
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      ) : (
        <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
        </svg>
      )}
    </button>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    codeToHtml(code, { lang: language, theme: "github-dark" })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        // Fallback: if language not supported, try plaintext
        if (!cancelled) {
          codeToHtml(code, { lang: "text", theme: "github-dark" })
            .then((result) => {
              if (!cancelled) setHtml(result);
            })
            .catch(() => { });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    return (
      <div className="relative group">
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <CodeBlockCopyButton code={code} />
      </div>
    );
  }
  return (
    <div className="relative group">
      <pre>
        <code>{code}</code>
      </pre>
      <CodeBlockCopyButton code={code} />
    </div>
  );
}

function FrontmatterBlock({ yaml }: { yaml: string }) {
  return (
    <details open className="mb-4">
      <summary className="cursor-pointer select-none text-gh-text-secondary text-sm font-medium py-1">
        Metadata
      </summary>
      <div className="mt-2">
        <CodeBlock language="yaml" code={yaml} />
      </div>
    </details>
  );
}

function RawView({ content }: { content: string }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    codeToHtml(content, { lang: "markdown", theme: "github-dark" })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) {
          codeToHtml(content, { lang: "text", theme: "github-dark" })
            .then((result) => {
              if (!cancelled) setHtml(result);
            })
            .catch(() => { });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [content]);

  if (html) {
    return <div className="[&_pre]:!rounded-none" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <pre>
      <code>{content}</code>
    </pre>
  );
}

export function MarkdownViewer({
  fileId,
  fileName,
  revision,
  onFileOpened,
  onHeadingsChange,
  onContentRendered,
  isTocOpen,
  onTocToggle,
  onRemoveFile,
  isWide,
}: MarkdownViewerProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRawView, setIsRawView] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const [prevFetchKey, setPrevFetchKey] = useState({ fileId, revision });

  if (fileId !== prevFetchKey.fileId || revision !== prevFetchKey.revision) {
    setPrevFetchKey({ fileId, revision });
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    fetchFileContent(fileId)
      .then((data) => {
        if (!cancelled) {
          setContent(data.content);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContent("Failed to load file.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, revision]);

  const handleLinkClick = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      e.preventDefault();
      try {
        const entry = await openRelativeFile(fileId, href);
        onFileOpened(entry.id);
      } catch {
        // fallback: do nothing
      }
    },
    [fileId, onFileOpened],
  );

  const components: Components = useMemo(
    () => ({
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children, ...props }) => {
        const language = extractLanguage(className);
        const code = String(children).replace(/\n$/, "");
        const isBlock = String(children).endsWith("\n");
        if (language) {
          if (language === "mermaid") {
            return <MermaidBlock code={code} />;
          }
          return <CodeBlock language={language} code={code} />;
        }
        if (isBlock) {
          return <CodeBlock language="text" code={code} />;
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
      img: ({ src, alt, ...props }) => {
        return <img src={resolveImageSrc(src, fileId)} alt={alt} {...props} />;
      },
      a: ({ href, children, ...props }) => {
        const resolved = resolveLink(href, fileId);
        switch (resolved.type) {
          case "external":
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          case "hash":
            return (
              <a href={href} {...props}>
                {children}
              </a>
            );
          case "markdown":
            return (
              <a href={href} onClick={(e) => handleLinkClick(e, resolved.hrefPath)} {...props}>
                {children}
              </a>
            );
          case "file":
            return (
              <a href={resolved.rawUrl} {...props}>
                {children}
              </a>
            );
          case "passthrough":
            return (
              <a href={href} {...props}>
                {children}
              </a>
            );
        }
      },
    }),
    [fileId, handleLinkClick],
  );

  const parsed = useMemo(
    () => (isRawView ? null : parseFrontmatter(content)),
    [content, isRawView],
  );

  const renderedContent = useMemo(() => {
    if (isRawView) {
      return <RawView content={content} />;
    }
    const base = parsed ? parsed.content : content;
    const md = fileName.endsWith(".mdx") ? stripMdxSyntax(base) : base;
    return (
      <>
        {parsed && <FrontmatterBlock yaml={parsed.yaml} />}
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeGithubAlerts, rehypeSlug, rehypeKatex]}
          components={components}
        >
          {md}
        </Markdown>
      </>
    );
  }, [content, isRawView, parsed, components, fileName]);

  const prevHeadingsKey = useRef("");
  useEffect(() => {
    const newHeadings: TocHeading[] = [];
    if (!isRawView && articleRef.current) {
      const els = articleRef.current.querySelectorAll("h1, h2, h3, h4, h5, h6");
      for (const el of els) {
        if (el.id) {
          newHeadings.push({
            id: el.id,
            text: el.textContent ?? "",
            level: parseInt(el.tagName.slice(1), 10),
          });
        }
      }
    }
    const key = newHeadings.map((h) => `${h.id}:${h.level}:${h.text}`).join(",");
    if (key !== prevHeadingsKey.current) {
      prevHeadingsKey.current = key;
      onHeadingsChange(newHeadings);
    }
  }, [isRawView, renderedContent, onHeadingsChange]);

  const onContentRenderedRef = useRef(onContentRendered);
  useLayoutEffect(() => {
    onContentRenderedRef.current = onContentRendered;
  });

  useLayoutEffect(() => {
    if (!loading) {
      onContentRenderedRef.current?.();
    }
  }, [loading, renderedContent]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-50 text-gh-text-secondary text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <article
        ref={articleRef}
        className={`markdown-body min-w-0 flex-1${isWide ? " markdown-body--wide" : ""}`}
      >
        {renderedContent}
      </article>
      <div className="shrink-0 flex flex-col gap-2 -mr-4 -mt-4">
        <TocToggle isTocOpen={isTocOpen} onToggle={onTocToggle} />
        <RawToggle isRaw={isRawView} onToggle={() => setIsRawView((v) => !v)} />
        <CopyButton content={content} />
        <PdfExportButton articleRef={articleRef} fileName={fileName} />
        <RemoveButton onRemove={onRemoveFile} />
      </div>
    </div>
  );
}
