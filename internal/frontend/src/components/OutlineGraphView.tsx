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

/** Safe for Mermaid edge label (no pipe/brackets). */
function escapeEdgeLabel(text: string, maxLen = 24): string {
  return text.replace(/["\[\]()|]/g, " ").trim().slice(0, maxLen);
}

/** Mermaid-safe node id (alphanumeric + underscore). */
function safeId(fileId: string, index: number): string {
  return `n_${fileId}_${index}`.replace(/-/g, "_");
}

/** File label node id (no subgraph: one node per file as section header). */
function fileLabelId(fileId: string): string {
  return `fl_${fileId.replace(/-/g, "_")}`;
}

type FlowDirection = "TB" | "LR";

function buildOutlineMermaid(
  outline: Outline,
  collapsedFiles: Set<string>,
  direction: FlowDirection,
): string {
  const lines: string[] = [`flowchart ${direction}`];
  for (const file of outline.files) {
    const flId = fileLabelId(file.id);
    const collapsed = collapsedFiles.has(file.id);
    const prefix = collapsed ? "▶ " : "▼ ";
    const nameEscaped = (prefix + file.name).replace(/"/g, "'");
    lines.push(`  subgraph ${flId}["${nameEscaped}"]`);
    if (!collapsed) {
      for (let i = 0; i < file.headings.length; i++) {
        const h = file.headings[i];
        const nid = safeId(file.id, i);
        const label = escapeMermaidLabel(h.text);
        lines.push(`    ${nid}[${label}]`);
      }
    }
    lines.push(`  end`);
  }
  // 组与组：文件到文件直连（合并同文件对的多条边），边标签优先用链接文本、否则 H1、否则目标文件名
  const fileIdsInOutline = new Set(outline.files.map((x) => x.id));
  const fileById = new Map(outline.files.map((f) => [f.id, f]));
  const emittedEdges = new Set<string>();
  for (const file of outline.files) {
    let currentH1 = "";
    const linkedToLabel = new Map<string, string>();
    for (const h of file.headings) {
      if (h.level === 1) currentH1 = h.text.trim();
      const linked = h.linkedFiles ?? h.linkedFileIds?.map((id) => ({ fileId: id, label: "" })) ?? [];
      for (const lf of linked) {
        const tid = lf.fileId;
        if (fileIdsInOutline.has(tid) && tid !== file.id && !linkedToLabel.has(tid)) {
          const label =
            lf.label?.trim() || currentH1 || (fileById.get(tid)?.name ?? tid);
          linkedToLabel.set(tid, label);
        }
      }
    }
    const flFrom = fileLabelId(file.id);
    for (const [targetId, label] of linkedToLabel) {
      const edgeKey = `${file.id}->${targetId}`;
      if (emittedEdges.has(edgeKey)) continue;
      emittedEdges.add(edgeKey);
      const lab = escapeEdgeLabel(label || (fileById.get(targetId)?.name ?? targetId));
      lines.push(`  ${flFrom} -->|${lab}| ${fileLabelId(targetId)}`);
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

const FLOW_DIRECTION_KEY = "mo-outline-graph-direction";

export function OutlineGraphView({ onClose }: OutlineGraphViewProps) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState("");
  const [showMermaidCode, setShowMermaidCode] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const [flowDirection, setFlowDirection] = useState<FlowDirection>(() => {
    try {
      const v = localStorage.getItem(FLOW_DIRECTION_KEY);
      if (v === "TB" || v === "LR") return v;
    } catch {
      /* ignore */
    }
    return "TB";
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<Outline | null>(null);

  const toggleFlowDirection = useCallback(() => {
    setFlowDirection((prev) => {
      const next = prev === "TB" ? "LR" : "TB";
      try {
        localStorage.setItem(FLOW_DIRECTION_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const mermaidCode = useMemo(
    () => (outline ? buildOutlineMermaid(outline, collapsedFiles, flowDirection) : ""),
    [outline, collapsedFiles, flowDirection],
  );

  useEffect(() => {
    let cancelled = false;
    fetchOutline()
      .then((data) => {
        if (!cancelled) {
          setOutline(data);
          outlineRef.current = data;
          setCollapsedFiles(new Set(data.files.map((f) => f.id)));
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
        <button
          type="button"
          className="bg-transparent border border-gh-border rounded-md px-2 py-1.5 text-gh-text-secondary text-sm hover:bg-gh-bg-hover"
          onClick={toggleFlowDirection}
          title={flowDirection === "TB" ? "上下布局（TB），点击切换为左右（LR）" : "左右布局（LR），点击切换为上下（TB）"}
        >
          {flowDirection === "TB" ? "上下" : "左右"}
        </button>
        <span className="text-gh-text-secondary text-sm">
          按文件分组，组内一二级标题，组间文件直连；点击文件名展开/折叠，点击标题在新标签页打开
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
