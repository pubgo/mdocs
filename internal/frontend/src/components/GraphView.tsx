import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import type { LinkGraph } from "../hooks/useApi";
import { fetchGraph } from "../hooks/useApi";
import { buildFileUrl } from "../utils/groups";
import { ZoomPanView } from "./ZoomPanView";

function getMermaidTheme(): "dark" | "default" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
}

/** Escape label for mermaid: use "..." and replace " with #quot; */
function escapeMermaidLabel(name: string): string {
  return `"${name.replace(/"/g, "#quot;").replace(/[\n\r]/g, " ")}"`;
}

/** Compute display label: if multiple nodes share the same name, add parent path to disambiguate. */
function nodeDisplayLabels(nodes: { id: string; name: string; path?: string }[]): Map<string, string> {
  const nameCount = new Map<string, number>();
  for (const n of nodes) {
    nameCount.set(n.name, (nameCount.get(n.name) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const n of nodes) {
    if ((nameCount.get(n.name) ?? 0) > 1 && n.path) {
      const parts = n.path.replace(/\/$/, "").split("/");
      const parent = parts.length > 1 ? parts[parts.length - 2] : parts[0] || "";
      labels.set(n.id, `${n.name} (${parent})`);
    } else {
      labels.set(n.id, n.name);
    }
  }
  return labels;
}

/** Build edge label: heading only when available. */
function edgeDisplayLabel(e: { label?: string; heading?: string }, targetName: string, maxLen = 32): string {
  const safe = (s: string) => s.replace(/["\[\]()|]/g, " ").trim();
  if (e.heading) {
    return safe(e.heading).slice(0, maxLen);
  }
  if (e.label && e.label.length > 0) {
    const lab = safe(e.label);
    if (lab) return lab.slice(0, maxLen);
  }
  return safe(targetName).slice(0, maxLen);
}

function buildMermaidFlowchart(graph: LinkGraph): string {
  // LR: 一个文件引用多个文件时，被引用的多个文件在右侧并列展示
  const lines: string[] = ["flowchart LR"];
  const nodeIds = new Set<string>();
  const nodeByName = new Map<string, string>();
  const displayLabels = nodeDisplayLabels(graph.nodes);
  for (const n of graph.nodes) {
    nodeIds.add(n.id);
    nodeByName.set(n.id, n.name);
    const label = escapeMermaidLabel(displayLabels.get(n.id) ?? n.name);
    lines.push(`  ${n.id}[${label}]`);
  }
  for (const e of graph.edges) {
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
      const targetName = nodeByName.get(e.to) ?? e.to;
      const lab = edgeDisplayLabel(e, targetName);
      if (lab) {
        lines.push(`  ${e.from} -->|${lab}| ${e.to}`);
      } else {
        lines.push(`  ${e.from} --> ${e.to}`);
      }
    }
  }
  return lines.join("\n");
}

/** Find fileId from click target by walking up and matching element id to graph nodes. */
function findFileIdFromElement(el: Element | null, nodeIds: string[]): string | null {
  let current: Element | null = el;
  while (current) {
    const id = (current as HTMLElement).id;
    if (id && typeof id === "string") {
      for (const nid of nodeIds) {
        if (id === nid || id.endsWith("-" + nid) || id.includes(nid)) return nid;
      }
    }
    current = current.parentElement;
  }
  return null;
}

interface GraphViewProps {
  onClose: () => void;
}

export function GraphView({ onClose }: GraphViewProps) {
  const [graph, setGraph] = useState<LinkGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState("");
  const [showMermaidCode, setShowMermaidCode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<LinkGraph | null>(null);

  const mermaidCode = useMemo(() => (graph ? buildMermaidFlowchart(graph) : ""), [graph]);

  useEffect(() => {
    let cancelled = false;
    fetchGraph()
      .then((data) => {
        if (!cancelled) {
          setGraph(data);
          graphRef.current = data;
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load graph");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNodeClick = useCallback((fileId: string, group?: string) => {
    const path = buildFileUrl(group ?? "default", fileId);
    window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
  }, []);

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    const code = mermaidCode;
    let cancelled = false;
    const width = containerRef.current?.offsetWidth ?? 800;
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.width = `${width}px`;
    document.body.appendChild(container);
    mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
    const mermaidId = `graph-view-${Date.now()}`;
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
  }, [graph, mermaidCode]);

  useEffect(() => {
    if (!svg || !graphRef.current || !svgContainerRef.current) return;
    svgContainerRef.current.innerHTML = svg;
    const container = svgContainerRef.current;
    const g = graphRef.current;
    const nodeIds = [...g.nodes.map((n) => n.id)].sort((a, b) => b.length - a.length);
    container.querySelectorAll(".node, [class*='node']").forEach((el) => {
      (el as HTMLElement).style.cursor = "pointer";
    });
    const onClick = (e: MouseEvent) => {
      const fileId = findFileIdFromElement(e.target as HTMLElement, nodeIds);
      if (!fileId || !g) return;
      const node = g.nodes.find((n) => n.id === fileId);
      const group = node?.group;
      handleNodeClick(fileId, group);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [svg, handleNodeClick]);

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    const observer = new MutationObserver(() => {
      mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
      const code = mermaidCode;
      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-9999px";
      container.style.width = `${containerRef.current?.offsetWidth ?? 800}px`;
      document.body.appendChild(container);
      const id = `graph-view-${Date.now()}`;
      mermaid
        .render(id, code, container)
        .then(({ svg: s }) => setSvg(s))
        .catch(() => {})
        .finally(() => container.remove());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [graph, mermaidCode]);

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

  if (!graph || graph.nodes.length === 0) {
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
          暂无文件或链接关系
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
          滚轮缩放、拖拽平移；点击节点在新标签页打开该文档
        </span>
      </div>
      {showMermaidCode && (
        <pre className="shrink-0 text-xs bg-gh-bg-subtle border border-gh-border rounded-md p-3 overflow-x-auto mb-2 font-mono text-gh-text-secondary">
          <code>{mermaidCode}</code>
        </pre>
      )}
      <div className="flex-1 min-h-0">
        <ZoomPanView className="h-full w-full">
          <div ref={svgContainerRef} className="inline-block p-4 min-w-full min-h-full [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:cursor-default" />
        </ZoomPanView>
      </div>
    </div>
  );
}
