import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { Outline } from "../hooks/useApi";
import { fetchOutline } from "../hooks/useApi";
import { buildFileUrl } from "../utils/groups";

const COLORS = [
  "#5B8FF9",
  "#F6BD16",
  "#5AD8A6",
  "#945FB9",
  "#E86452",
  "#6DC8EC",
  "#FF99C3",
  "#1E9493",
  "#FF9845",
  "#5D7092",
];

interface PackNodeData {
  name: string;
  type: "root" | "file" | "h1" | "h2";
  fileId?: string;
  group?: string;
  h1Text?: string;
  h2Text?: string;
  value?: number;
  children?: PackNodeData[];
}

function parseOutlineToPack(outline: Outline): PackNodeData {
  const fileIds = new Set(outline.files.map((f) => f.id));
  const fileById = new Map(outline.files.map((f) => [f.id, f]));

  const children: PackNodeData[] = outline.files.map((file) => {
    let h1Text = file.name;
    const nodeChildren: PackNodeData[] = [];

    for (let i = 0; i < file.headings.length; i++) {
      const h = file.headings[i];
      if (h.level === 1) {
        if (h1Text === file.name) h1Text = h.text;
        const h2Children: PackNodeData[] = [];
        for (let j = i + 1; j < file.headings.length; j++) {
          const h2 = file.headings[j];
          if (h2.level === 1) break;
          if (h2.level === 2) {
            h2Children.push({
              name: h2.text,
              type: "h2",
              fileId: file.id,
              group: file.group,
              h2Text: h2.text,
              value: 2,
            });
          }
        }
        nodeChildren.push({
          name: h.text,
          type: "h1",
          fileId: file.id,
          group: file.group,
          h1Text: h.text,
          value: 4,
          children: h2Children.length > 0 ? h2Children : undefined,
        });
      }
    }

    const linkedIds = new Set<string>();
    for (const h of file.headings) {
      for (const lf of h.linkedFiles ?? []) {
        if (fileIds.has(lf.fileId) && lf.fileId !== file.id) linkedIds.add(lf.fileId);
      }
      for (const id of h.linkedFileIds ?? []) {
        if (fileIds.has(id) && id !== file.id) linkedIds.add(id);
      }
    }

    for (const tid of linkedIds) {
      const target = fileById.get(tid);
      if (target) {
        const targetH1 = target.headings.find((h) => h.level === 1)?.text;
        nodeChildren.push({
          name: targetH1 ?? target.name,
          type: "file",
          fileId: target.id,
          group: target.group,
          h1Text: targetH1 ?? target.name,
          value: 8,
        });
      }
    }

    return {
      name: h1Text ?? file.name,
      type: "file",
      fileId: file.id,
      group: file.group,
      h1Text,
      value: 1,
      children: nodeChildren.length > 0 ? nodeChildren : undefined,
    };
  });

  return {
    name: "root",
    type: "root",
    children,
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
}

interface OutlineGravityViewProps {
  onClose: () => void;
}

export function OutlineGravityView({ onClose }: OutlineGravityViewProps) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 700, h: 450 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOutline()
      .then((data) => {
        if (!cancelled) {
          setOutline(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to fetch outline");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !outline) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 700, height: 450 };
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height });
    return () => ro.disconnect();
  }, [outline]);

  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute("data-theme"));
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !outline || outline.files.length === 0) return;

    const data = parseOutlineToPack(outline);
    const width = size.w;
    const height = size.h;
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const bgColor = isDark ? "#21262d" : "#f6f8fa";
    const textColor = isDark ? "#e6edf3" : "#1f2328";
    const strokeColor = isDark ? "#30363d" : "#d0d7de";

    const pack = d3
      .pack<PackNodeData>()
      .size([width, height])
      .padding(3);

    const root = pack(
      d3
        .hierarchy(data)
        .sum((d) => d.value ?? 1)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    );

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    svg
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", `background: ${bgColor}; cursor: grab;`)
      .style("touch-action", "none");

    const zoomRoot = svg.append("g").attr("class", "zoom-root");

    const node = zoomRoot
      .append("g")
      .selectAll<SVGCircleElement, d3.HierarchyCircularNode<PackNodeData>>("circle")
      .data(root.descendants().slice(1))
      .join("circle")
      .attr("fill", (d) => {
        const t = d.data.type;
        const idx = outline.files.findIndex((f) => f.id === d.data.fileId);
        const c = COLORS[idx >= 0 ? idx % COLORS.length : 0];
        if (t === "file") return c;
        if (t === "h1") return c;
        if (t === "h2") return isDark ? `${c}40` : `${c}30`;
        return c;
      })
      .attr("stroke", (d) => {
        const t = d.data.type;
        const idx = outline.files.findIndex((f) => f.id === d.data.fileId);
        const c = COLORS[idx >= 0 ? idx % COLORS.length : 0];
        if (t === "file") return strokeColor;
        if (t === "h1" || t === "h2") return c;
        return strokeColor;
      })
      .attr("stroke-width", (d) => (d.data.type === "file" ? 2 : 0))
      .attr("stroke-width", (d) => {
        const hasStroke = ["file", "h1", "h2"].includes(d.data.type);
        return hasStroke ? 2 : 0;
      })
      .attr("pointer-events", "all")
      .on("mouseover", function () {
        d3.select(this).attr("stroke-width", 3);
      })
      .on("mouseout", function (_, d) {
        const hasStroke = ["file", "h1", "h2"].includes(d.data.type);
        d3.select(this).attr("stroke-width", hasStroke ? 2 : 0);
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        const data = d.data;
        if (data.type === "h2" && data.fileId && data.group) {
          const slug = data.h2Text ? slugify(data.h2Text) : "";
          const path = buildFileUrl(data.group, data.fileId);
          const hash = slug ? `#${slug}` : "";
          window.open(`${window.location.origin}${path}${hash}`, "_blank", "noopener,noreferrer");
        } else if (data.type === "file" && data.fileId && data.group && !d.children) {
          const path = buildFileUrl(data.group, data.fileId);
          window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
        } else if (focus !== d) {
          zoom(event, d);
        }
      });

    const label = zoomRoot
      .append("g")
      .style("font", "10px sans-serif")
      .attr("pointer-events", "none")
      .attr("text-anchor", "middle")
      .selectAll<SVGTextElement, d3.HierarchyCircularNode<PackNodeData>>("text")
      .data(root.descendants())
      .join("text")
      .style("fill", textColor)
      .style("fill-opacity", (d) => {
        if (d.parent !== root) return 0;
        if (d.data.type === "h2") return 0;
        return 1;
      })
      .style("display", (d) => {
        if (d.parent !== root) return "none";
        if (d.data.type === "h2") return "none";
        return "inline";
      })
      .style("font-weight", (d) => (d.data.type === "h1" ? 600 : 400))
      .style("font-size", (d) => {
        if (d.data.type === "root") return 0;
        if (d.data.type === "file") return Math.min(14, d.r / 2);
        if (d.data.type === "h1") return Math.min(12, d.r);
        return Math.min(10, d.r * 1.2);
      })
      .text((d) => {
        if (d.data.type === "root") return "";
        if (d.data.type === "file") return d.data.h1Text ?? d.data.name;
        if (d.data.type === "h1") return d.data.h1Text ?? d.data.name;
        if (d.data.type === "h2") return d.data.h2Text ?? d.data.name;
        return d.data.name;
      });

    let focus = root;
    let view: [number, number, number] = [width / 2, height / 2, root.r * 2];
    let currentZoomK = 1;
    const H2_VISIBLE_ZOOM = 1.05;

    function updateLabelVisibility() {
      label
        .style("fill-opacity", (n) => {
          if (n.parent !== focus) return 0;
          if (n.data.type === "h2") return currentZoomK >= H2_VISIBLE_ZOOM ? 1 : 0;
          return 1;
        })
        .style("display", (n) => {
          if (n.parent !== focus) return "none";
          if (n.data.type === "h2") return currentZoomK >= H2_VISIBLE_ZOOM ? "inline" : "none";
          return "inline";
        });
    }

    function zoomTo(v: [number, number, number]) {
      const k = width / v[2];
      view = v;
      node.attr("transform", (d) => `translate(${(d.x - v[0]) * k + width / 2},${(d.y - v[1]) * k + height / 2})`);
      node.attr("r", (d) => d.r * k);
      label.attr("transform", (d) => `translate(${(d.x - v[0]) * k + width / 2},${(d.y - v[1]) * k + height / 2})`);
      label.style("font-size", (d) => {
        if (d.data.type === "root") return "0";
        const r = d.r * k;
        if (d.data.type === "file") return `${Math.min(14, r / 2)}px`;
        if (d.data.type === "h1") return `${Math.min(12, r)}px`;
        return `${Math.min(10, r * 1.2)}px`;
      });
      updateLabelVisibility();
    }

    function zoom(event: MouseEvent, d: d3.HierarchyCircularNode<PackNodeData>) {
      focus = d;
      svg
        .transition()
        .duration(event.altKey ? 2500 : 750)
        .tween("zoom", () => {
          const i = d3.interpolateZoom(view, [d.x, d.y, d.r * 2]);
          return (t) => zoomTo(i(t));
        });

      updateLabelVisibility();
    }

    zoomTo([focus.x, focus.y, focus.r * 2]);

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 8])
      .on("zoom", (event) => {
        zoomRoot.attr("transform", event.transform.toString());
        currentZoomK = event.transform.k;
        updateLabelVisibility();
      });
    svg.call(zoomBehavior);

    svg.on("click.zoom-out", (event) => {
      if (event.target === svgEl) {
        zoom(event as unknown as MouseEvent, root);
      }
    });

    node.attr("title", (d) => {
      const data = d.data;
      if (data.type === "h2" && data.fileId) return `点击打开: ${data.h2Text}`;
      if (data.type === "file" && data.fileId) return `点击打开: ${data.name}`;
      return data.name;
    });

    const resetZoom = () => {
      zoom({ altKey: false } as MouseEvent, root);
      svg.transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity);
    };
    (svgEl as SVGSVGElement & { _resetZoom?: () => void })._resetZoom = resetZoom;

    return () => {
      svg.on("click.zoom-out", null);
      svg.on(".zoom", null);
      svg.selectAll("circle").on("click", null);
      delete (svgEl as SVGSVGElement & { _resetZoom?: () => void })._resetZoom;
    };
  }, [outline, size, theme]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex shrink-0 gap-2 pb-2">
          <button
            type="button"
            className="rounded-md border border-gh-border bg-transparent px-2 py-1.5 text-sm text-gh-text-secondary hover:bg-gh-bg-hover"
            onClick={onClose}
          >
            返回文档
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-gh-text-secondary">
          加载中…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex shrink-0 gap-2 pb-2">
          <button
            type="button"
            className="rounded-md border border-gh-border bg-transparent px-2 py-1.5 text-sm text-gh-text-secondary hover:bg-gh-bg-hover"
            onClick={onClose}
          >
            返回文档
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-red-500">{error}</div>
      </div>
    );
  }

  if (!outline || outline.files.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex shrink-0 gap-2 pb-2">
          <button
            type="button"
            className="rounded-md border border-gh-border bg-transparent px-2 py-1.5 text-sm text-gh-text-secondary hover:bg-gh-bg-hover"
            onClick={onClose}
          >
            返回文档
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-gh-text-secondary">
          暂无文档或标题
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <button
          type="button"
          className="rounded-md border border-gh-border bg-transparent px-2 py-1.5 text-sm text-gh-text-secondary hover:bg-gh-bg-hover"
          onClick={onClose}
        >
          返回文档
        </button>
        <button
          type="button"
          className="rounded-md border border-gh-border bg-transparent px-2 py-1.5 text-sm text-gh-text-secondary hover:bg-gh-bg-hover"
          onClick={() => (svgRef.current as SVGSVGElement & { _resetZoom?: () => void })?._resetZoom?.()}
        >
          重置视图
        </button>
        <span className="text-sm text-gh-text-secondary">
          圆 packing 视图：圆心显示一级标题；缩小只显示 H1，放大后显示 H2 及引用文档的 H1；滚轮缩放、拖拽画布；点击圆放大
        </span>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
        <svg ref={svgRef} className="h-full w-full" />
      </div>
    </div>
  );
}
