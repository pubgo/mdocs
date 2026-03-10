import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import type { Outline } from "../hooks/useApi";
import { fetchOutline } from "../hooks/useApi";
import { buildFileUrl } from "../utils/groups";
import { ZoomPanView } from "./ZoomPanView";

function getMermaidTheme(): "dark" | "default" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
}

function escapeMermaidLabel(text: string): string {
  return `"${text.replace(/"/g, "#quot;").replace(/[\n\r]/g, " ").slice(0, 40)}"`;
}

/** Mermaid-safe node id (alphanumeric + underscore). */
function safeId(fileId: string, index: number): string {
  return `n_${fileId}_${index}`.replace(/-/g, "_");
}

/** File label node id (no subgraph: one node per file as section header). */
function fileLabelId(fileId: string): string {
  return `fl_${fileId.replace(/-/g, "_")}`;
}

function buildOutlineMermaid(outline: Outline, collapsedFiles: Set<string>): string {
  const lines: string[] = ["flowchart TB"];
  for (let f = 0; f < outline.files.length; f++) {
    const file = outline.files[f];
    const flId = fileLabelId(file.id);
    const collapsed = collapsedFiles.has(file.id);
    const prefix = collapsed ? "▶ " : "▼ ";
    const nameEscaped = (prefix + file.name).replace(/"/g, "'");
    lines.push(`  ${flId}["${nameEscaped}"]`);
    if (!collapsed) {
      for (let i = 0; i < file.headings.length; i++) {
        const h = file.headings[i];
        const nid = safeId(file.id, i);
        const label = escapeMermaidLabel(h.text);
        lines.push(`  ${nid}[${label}]`);
      }
      if (file.headings.length > 0) {
        lines.push(`  ${flId} --> ${safeId(file.id, 0)}`);
      }
      for (let i = 0; i < file.headings.length; i++) {
        if (file.headings[i].level !== 1) continue;
        const fromId = safeId(file.id, i);
        for (let j = i + 1; j < file.headings.length; j++) {
          if (file.headings[j].level === 1) break;
          lines.push(`  ${fromId} --> ${safeId(file.id, j)}`);
        }
      }
      // 每个标题下的关联文件：从对应标题指向被引用文件的文件名节点
      const fileIdsInOutline = new Set(outline.files.map((x) => x.id));
      for (let i = 0; i < file.headings.length; i++) {
        const linkedIds = file.headings[i].linkedFileIds;
        if (!linkedIds?.length) continue;
        const fromId = safeId(file.id, i);
        for (const targetId of linkedIds) {
          if (fileIdsInOutline.has(targetId)) {
            lines.push(`  ${fromId} --> ${fileLabelId(targetId)}`);
          }
        }
      }
    }
  }
  return lines.join("\n");
}

/** Find fileId and whether the click was on the file label node (for expand/collapse). */
function findFileIdAndIsLabel(
  el: Element | null,
  fileIds: string[],
): { fileId: string; isFileLabel: boolean } | null {
  let current: Element | null = el;
  while (current) {
    const id = (current as HTMLElement).id;
    if (id && typeof id === "string") {
      for (const fid of fileIds) {
        const fidSafe = fid.replace(/-/g, "_");
        // Mermaid may prefix node ids (e.g. "outline-view-123-fl_abc_def"), so match by content
        const isFileLabel =
          id.includes("fl_") &&
          id.includes(fidSafe) &&
          !id.includes("n_" + fidSafe + "_");
        if (isFileLabel) return { fileId: fid, isFileLabel: true };
        if (
          id.includes("n_" + fidSafe + "_") ||
          id === fid ||
          id.endsWith("-" + fid)
        )
          return { fileId: fid, isFileLabel: false };
      }
    }
    current = current.parentElement;
  }
  return null;
}

interface OutlineGraphViewProps {
  onClose: () => void;
}

export function OutlineGraphView({ onClose }: OutlineGraphViewProps) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState("");
  const [showMermaidCode, setShowMermaidCode] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<Outline | null>(null);

  const mermaidCode = useMemo(
    () => (outline ? buildOutlineMermaid(outline, collapsedFiles) : ""),
    [outline, collapsedFiles],
  );

  useEffect(() => {
    let cancelled = false;
    fetchOutline()
      .then((data) => {
        if (!cancelled) {
          setOutline(data);
          outlineRef.current = data;
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load outline");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCollapse = useCallback((fileId: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const handleNodeClick = useCallback(
    (result: { fileId: string; isFileLabel: boolean } | null, group?: string) => {
      if (!result) return;
      if (result.isFileLabel) {
        toggleCollapse(result.fileId);
        return;
      }
      const path = buildFileUrl(group ?? "default", result.fileId);
      window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
    },
    [toggleCollapse],
  );

  useEffect(() => {
    if (!outline || outline.files.length === 0) return;
    const code = mermaidCode;
    let cancelled = false;
    const width = containerRef.current?.offsetWidth ?? 800;
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.width = `${width}px`;
    document.body.appendChild(container);
    mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
    const mermaidId = `outline-view-${Date.now()}`;
    mermaid
      .render(mermaidId, code, container)
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) setSvg("");
      })
      .finally(() => container.remove());
    return () => {
      cancelled = true;
    };
  }, [outline, mermaidCode]);

  useEffect(() => {
    if (!svg || !outlineRef.current || !svgContainerRef.current) return;
    svgContainerRef.current.innerHTML = svg;
    const container = svgContainerRef.current;
    const outlineData = outlineRef.current;
    const fileIds = outlineData.files.map((f) => f.id);
    container.querySelectorAll(".node, [class*='node'], [class*='cluster']").forEach((el) => {
      (el as HTMLElement).style.cursor = "pointer";
    });
    const onClick = (e: MouseEvent) => {
      const result = findFileIdAndIsLabel(e.target as HTMLElement, fileIds);
      if (!result || !outlineData) return;
      const file = outlineData.files.find((f) => f.id === result.fileId);
      if (file) handleNodeClick(result, file.group);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [svg, handleNodeClick]);

  useEffect(() => {
    if (!outline || outline.files.length === 0) return;
    const observer = new MutationObserver(() => {
      mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
      const code = mermaidCode;
      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-9999px";
      container.style.width = `${containerRef.current?.offsetWidth ?? 800}px`;
      document.body.appendChild(container);
      const id = `outline-view-${Date.now()}`;
      mermaid
        .render(id, code, container)
        .then(({ svg: s }) => setSvg(s))
        .catch(() => {})
        .finally(() => container.remove());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [outline, mermaidCode]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 shrink-0 pb-2">
          <button
            type="button"
            className="bg-transparent border border-gh-border rounded-md px-2 py-1.5 text-gh-text-secondary text-sm hover:bg-gh-bg-hover"
            onClick={onClose}
          >
            返回文档
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-gh-text-secondary text-sm">
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 shrink-0 pb-2">
          <button
            type="button"
            className="bg-transparent border border-gh-border rounded-md px-2 py-1.5 text-gh-text-secondary text-sm hover:bg-gh-bg-hover"
            onClick={onClose}
          >
            返回文档
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  if (!outline || outline.files.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 shrink-0 pb-2">
          <button
            type="button"
            className="bg-transparent border border-gh-border rounded-md px-2 py-1.5 text-gh-text-secondary text-sm hover:bg-gh-bg-hover"
            onClick={onClose}
          >
            返回文档
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-gh-text-secondary text-sm">
          暂无文档或标题
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <div className="flex items-center gap-2 shrink-0 pb-2 flex-wrap">
        <button
          type="button"
          className="bg-transparent border border-gh-border rounded-md px-2 py-1.5 text-gh-text-secondary text-sm hover:bg-gh-bg-hover"
          onClick={onClose}
        >
          返回文档
        </button>
        <button
          type="button"
          className="bg-transparent border border-gh-border rounded-md px-2 py-1.5 text-gh-text-secondary text-sm hover:bg-gh-bg-hover"
          onClick={() => setShowMermaidCode((v) => !v)}
          title="显示 Mermaid 源码"
        >
          {showMermaidCode ? "隐藏源码" : "显示 Mermaid 源码"}
        </button>
        <span className="text-gh-text-secondary text-sm">
          按文件分组，展示一二级标题；点击文件名展开/折叠，点击标题在新标签页打开
        </span>
      </div>
      {showMermaidCode && (
        <pre className="shrink-0 text-xs bg-gh-bg-subtle border border-gh-border rounded-md p-3 overflow-x-auto mb-2 font-mono text-gh-text-secondary">
          <code>{mermaidCode}</code>
        </pre>
      )}
      <div className="flex-1 min-h-0">
        <ZoomPanView className="h-full w-full">
          <div ref={svgContainerRef} className="inline-block p-4 min-w-full min-h-full [&_svg]:max-w-full [&_svg]:h-auto" />
        </ZoomPanView>
      </div>
    </div>
  );
}
