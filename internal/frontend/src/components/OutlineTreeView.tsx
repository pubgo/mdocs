import { useCallback, useEffect, useRef, useState } from "react";
import { Graph, idOf, positionOf, treeToGraphData } from "@antv/g6";
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

interface TreeDataNode {
  id: string;
  data: {
    value: string;
    depth?: number;
    fileId?: string;
    group?: string;
    targetFileId?: string;
    targetGroup?: string;
    isFile?: boolean;
    isH1?: boolean;
    isH2?: boolean;
    isLink?: boolean;
    hasLinks?: boolean;
    hasChildren?: boolean;
    fileColorIndex?: number;
  };
  children?: TreeDataNode[];
}

type OutlineFile = Outline["files"][number];

const MAX_LINK_DEPTH = 4;

function buildFileOutline(
  file: OutlineFile,
  outline: Outline,
  fileIds: Set<string>,
  fileById: Map<string, OutlineFile>,
  fileColorIndex: number,
  visited: Set<string>,
  depth: number,
  pathPrefix: string,
  collapsedIds: Set<string>,
): TreeDataNode[] {
  if (depth >= MAX_LINK_DEPTH || visited.has(file.id)) return [];
  visited.add(file.id);

  const idPrefix = pathPrefix ? `${pathPrefix}_` : "";

  const h1Nodes: TreeDataNode[] = [];
  for (let i = 0; i < file.headings.length; i++) {
    const h = file.headings[i];
    if (h.level === 1) {
      const h2Nodes: TreeDataNode[] = [];
      for (let j = i + 1; j < file.headings.length; j++) {
        const h2 = file.headings[j];
        if (h2.level === 1) break;
        if (h2.level === 2) {
          const linked = (h2.linkedFileIds ?? []).filter((id) => fileIds.has(id));
          const h2Id = `${idPrefix}n_${file.id}_${j}`.replace(/-/g, "_");

          const linkChildren: TreeDataNode[] = [];
          for (const tid of linked) {
            const target = fileById.get(tid);
            const targetFile = outline.files.find((f) => f.id === tid);
            const linkId = `${idPrefix}link_${file.id}_${j}_${tid}`.replace(/-/g, "_");
            const targetColorIdx = targetFile
              ? outline.files.indexOf(targetFile) % COLORS.length
              : 0;
            const hasTargetContent = !!(targetFile?.headings.length);
            const targetOutline =
              hasTargetContent && !collapsedIds.has(linkId)
                ? buildFileOutline(
                    targetFile,
                    outline,
                    fileIds,
                    fileById,
                    targetColorIdx,
                    new Set(visited),
                    depth + 1,
                    linkId,
                    collapsedIds,
                  )
                : [];

            linkChildren.push({
              id: linkId,
              data: {
                value: `→ ${target?.name ?? tid}`,
                targetFileId: tid,
                targetGroup: target?.group ?? "default",
                isLink: true,
                hasChildren: hasTargetContent,
                fileColorIndex: targetColorIdx,
              },
              children: targetOutline.length > 0 ? targetOutline : undefined,
            });
          }

          const hasLinks = linkChildren.length > 0;
          const h2Collapsed = collapsedIds.has(h2Id);
          h2Nodes.push({
            id: h2Id,
            data: {
              value: h2.text,
              fileId: file.id,
              group: file.group,
              isH2: true,
              hasLinks,
              hasChildren: hasLinks,
              fileColorIndex,
            },
            children: hasLinks && !h2Collapsed ? linkChildren : undefined,
          });
        }
      }

      const h1Id = `${idPrefix}h1_${file.id}_${i}`.replace(/-/g, "_");
      const h1Collapsed = collapsedIds.has(h1Id);
      h1Nodes.push({
        id: h1Id,
        data: {
          value: h.text,
          fileId: file.id,
          group: file.group,
          isH1: true,
          hasChildren: h2Nodes.length > 0,
          fileColorIndex,
        },
        children: h2Nodes.length > 0 && !h1Collapsed ? h2Nodes : undefined,
      });
    }
  }

  visited.delete(file.id);
  return h1Nodes;
}

function findRootFiles(outline: Outline): OutlineFile[] {
  const fileIds = new Set(outline.files.map((f) => f.id));
  const linkedTo = new Set<string>();
  for (const file of outline.files) {
    for (const h of file.headings) {
      for (const tid of h.linkedFileIds ?? []) {
        if (fileIds.has(tid)) linkedTo.add(tid);
      }
    }
  }
  return outline.files.filter((f) => !linkedTo.has(f.id));
}

const MANY_FILES_THRESHOLD = 6;

/** 默认折叠：H2 和链接节点；文档名、H1 展开以展示层级。文件多时默认折叠文件节点以减小宽度。 */
function collectDefaultCollapsedIds(outline: Outline): Set<string> {
  const ids = new Set<string>();
  const fileIds = new Set(outline.files.map((f) => f.id));
  const safe = (s: string) => s.replace(/-/g, "_");
  const collapseFiles = outline.files.length > MANY_FILES_THRESHOLD;

  function collectFromFile(file: OutlineFile, pathPrefix: string, visited: Set<string>) {
    if (visited.has(file.id)) return;
    visited.add(file.id);
    const prefix = pathPrefix ? `${pathPrefix}_` : "";
    for (let i = 0; i < file.headings.length; i++) {
      const h = file.headings[i];
      if (h.level !== 1) continue;
      for (let j = i + 1; j < file.headings.length; j++) {
        const h2 = file.headings[j];
        if (h2.level === 1) break;
        if (h2.level === 2) {
          ids.add(`${prefix}n_${safe(file.id)}_${j}`);
          const linked = (h2.linkedFileIds ?? []).filter((id) => fileIds.has(id));
          for (const tid of linked) {
            const targetFile = outline.files.find((f) => f.id === tid);
            if (targetFile?.headings.length) {
              ids.add(`${prefix}link_${safe(file.id)}_${j}_${safe(tid)}`);
              collectFromFile(targetFile, `${prefix}link_${safe(file.id)}_${j}_${safe(tid)}`, visited);
            }
          }
        }
      }
    }
    visited.delete(file.id);
  }

  const rootFiles = findRootFiles(outline);
  const files = rootFiles.length > 0 ? rootFiles : outline.files;
  for (const file of files) {
    if (collapseFiles) ids.add(`fl_${safe(file.id)}`);
    collectFromFile(file, "", new Set());
  }
  return ids;
}

function outlineToTreeData(outline: Outline, collapsedIds: Set<string>): TreeDataNode {
  const fileIds = new Set(outline.files.map((f) => f.id));
  const fileById = new Map(outline.files.map((f) => [f.id, f]));
  const rootFiles = findRootFiles(outline);
  const fileNodes: TreeDataNode[] = (rootFiles.length > 0 ? rootFiles : outline.files).map(
    (file, idx) => {
      const fileIdx = outline.files.findIndex((f) => f.id === file.id);
      const fileColorIndex = (fileIdx >= 0 ? fileIdx : idx) % COLORS.length;
      const h1Nodes = buildFileOutline(
        file,
        outline,
        fileIds,
        fileById,
        fileColorIndex,
        new Set(),
        0,
        "",
        collapsedIds,
      );

      const fileId = `fl_${file.id.replace(/-/g, "_")}`;
      const fileCollapsed = collapsedIds.has(fileId);
      return {
        id: fileId,
        data: {
          value: file.name,
          fileId: file.id,
          group: file.group,
          isFile: true,
          hasChildren: h1Nodes.length > 0,
          fileColorIndex,
        },
        children: h1Nodes.length > 0 && !fileCollapsed ? h1Nodes : undefined,
      };
    },
  );

  const rootCollapsed = collapsedIds.has("root");
  const root: TreeDataNode = {
    id: "root",
    data: { value: "文档" },
    children: rootCollapsed ? undefined : fileNodes,
  };

  function assignDepth(node: TreeDataNode, depth: number) {
    node.data.depth = depth;
    node.children?.forEach((c) => assignDepth(c, depth + 1));
  }
  assignDepth(root, 0);

  return root;
}

/** 根据节点文本计算宽度 */
function getNodeWidth(text: string, isRoot: boolean): number {
  const padding = isRoot ? 40 : 24;
  const len = typeof text === "string" ? text.length : 0;
  return Math.max(60, Math.min(len * 8 + padding, 240));
}

function getNodeSize(
  d: { data?: { value?: string }; value?: string },
  isRoot: boolean,
): [number, number] {
  const text = (d.value ?? d.data?.value ?? "") as string;
  const width = getNodeWidth(text, isRoot);
  const height = isRoot ? 40 : 36;
  return [width, height];
}

/** 判断节点在根左侧还是右侧 */
function getNodeSide(
  nodeData: { id: string; style?: { x?: number; y?: number } },
  parentData: { id: string; style?: { x?: number; y?: number } } | undefined,
): "left" | "right" | "center" {
  if (!parentData) return "center";
  const nodePos = positionOf(nodeData);
  const parentPos = positionOf(parentData);
  return parentPos[0] > nodePos[0] ? "left" : "right";
}

interface OutlineTreeViewProps {
  onClose: () => void;
}

const LAYOUT_DIRECTION_KEY = "mo-outline-layout-direction";

export function OutlineTreeView({ onClose }: OutlineTreeViewProps) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [layoutDirection, setLayoutDirection] = useState<"H" | "V">(() => {
    try {
      const v = localStorage.getItem(LAYOUT_DIRECTION_KEY);
      if (v === "V" || v === "H") return v;
    } catch {
      /* ignore */
    }
    return "H";
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<InstanceType<typeof Graph> | null>(null);

  const toggleLayoutDirection = useCallback(() => {
    setLayoutDirection((prev) => {
      const next = prev === "H" ? "V" : "H";
      try {
        localStorage.setItem(LAYOUT_DIRECTION_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOutline()
      .then((data) => {
        if (!cancelled) {
          setOutline(data);
          setCollapsedIds(collectDefaultCollapsedIds(data));
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

  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleNodeClick = useCallback(
    (_nodeId: string, d: TreeDataNode["data"]) => {
      if (d.isLink && d.targetFileId && d.targetGroup) {
        const path = buildFileUrl(d.targetGroup, d.targetFileId);
        window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
      } else if ((d.isFile || d.isH1 || (d.isH2 && !d.hasLinks)) && d.fileId && d.group) {
        const path = buildFileUrl(d.group, d.fileId);
        window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
      }
    },
    [],
  );

  useEffect(() => {
    if (!outline || outline.files.length === 0 || !containerRef.current) return;

    const treeData = outlineToTreeData(outline, collapsedIds);
    const graphData = treeToGraphData(treeData, {
      getNodeData: (datum, depth) => {
        const node = datum as TreeDataNode;
        const value = node.data?.value ?? node.id;
        const base = node.children
          ? { id: node.id, data: node.data, depth, children: node.children.map((c) => c.id) }
          : { id: node.id, data: node.data, depth };
        return { ...base, value };
      },
      getChildren: (datum) => (datum as TreeDataNode).children ?? [],
    });

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const textColor = isDark ? "#e6edf3" : "#1f2328";
    const fillColor = isDark ? "#21262d" : "#ffffff";
    const rootFill = isDark ? "#30363d" : "#EFF0F0";

    const rootId = "root";
    let g: InstanceType<typeof Graph> | null = null;

    const graph = new Graph({
      container: containerRef.current,
      width: containerRef.current.offsetWidth,
      height: containerRef.current.offsetHeight,
      data: graphData,
      autoFit: "view",
      layout: {
        type: "mindmap",
        direction: layoutDirection,
        getHeight: () => 36,
        getWidth: (node: { id: string; data?: { value?: string }; value?: string }) =>
          getNodeWidth((node.value ?? node.data?.value ?? "") as string, node.id === rootId),
        getVGap: () => 24,
        getHGap: () =>
          (outline?.files.length ?? 0) > MANY_FILES_THRESHOLD ? 24 : 48,
        animation: false,
      },
      node: {
        style: (d) => {
          const nodeId = idOf(d);
          const isRoot = nodeId === rootId;
          const parent = g?.getParentData?.(nodeId, "tree");
          const direction = getNodeSide(d, parent);
          const colorIdx = (d.data?.fileColorIndex as number) ?? 0;
          const color = COLORS[colorIdx % COLORS.length] ?? "#5D7092";

          const data = d.data as TreeDataNode["data"];
          const collapsed = collapsedIds.has(nodeId);
          const hasChildren = (d as { children?: unknown[] }).children?.length;
          const canCollapse =
            collapsed ||
            (nodeId === rootId && hasChildren) ||
            (data?.isFile && data?.hasChildren) ||
            (data?.isH1 && data?.hasChildren) ||
            (data?.isH2 && data?.hasLinks) ||
            (data?.isLink && data?.hasChildren);
          const displayText = (d.value ?? d.data?.value ?? "") as string;
          const isRootNode = nodeId === rootId;
          const labelText = isRootNode
            ? displayText
            : canCollapse
              ? `${collapsed ? "▶ " : "▼ "}${displayText}`
              : displayText;
          const baseSize = getNodeSize(d, isRoot);
          const size: [number, number] = canCollapse
            ? [baseSize[0] + 20, baseSize[1]]
            : baseSize;
          return {
            size,
            fill: isRoot ? rootFill : fillColor,
            stroke: isRoot ? (canCollapse ? color : "transparent") : color,
            lineWidth: canCollapse ? 2 : 1,
            lineDash: collapsed ? [4, 4] : undefined,
            radius: 6,
            labelText,
            labelFill: isRoot ? (isDark ? "#e6edf3" : "#262626") : textColor,
            labelFontSize: isRoot ? 18 : 14,
            labelFontWeight: isRoot ? 600 : 400,
            labelPlacement: "center",
            labelMaxWidth: 220,
            labelTextOverflow: "ellipsis",
            labelBackground: true,
            labelBackgroundFill: canCollapse ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)") : "transparent",
            labelPadding: direction === "left" ? [2, 0, 10, 40] : [2, 40, 10, 0],
            visibility: "visible" as const,
            cursor: canCollapse ? "pointer" : undefined,
            ports: isRoot
              ? [{ placement: "right" }, { placement: "left" }]
              : [{ placement: "right-bottom" }, { placement: "left-bottom" }],
          };
        },
      },
      edge: {
        type: "cubic-horizontal",
        style: (d: { source: string; target: string }) => {
          const targetData = g?.getNodeData(d.target);
          const colorIdx = (targetData?.data?.fileColorIndex as number) ?? 0;
          const color = COLORS[colorIdx % COLORS.length] ?? "#99ADD1";
          return { lineWidth: 2, stroke: color };
        },
      },
      behaviors: [
        { type: "scroll-canvas", key: "scroll-canvas" },
        { type: "drag-canvas", key: "drag-canvas" },
        { type: "zoom-canvas", key: "zoom-canvas" },
      ],
    });

    g = graph;
    graph.render();

    const handleClick = (evt: unknown) => {
      const e = evt as {
        target?: { id?: string };
        ctrlKey?: boolean;
        metaKey?: boolean;
        nativeEvent?: { ctrlKey?: boolean; metaKey?: boolean };
      };
      const nodeId = e.target?.id;
      if (!nodeId) return;
      const nodeData = graph.getNodeData(nodeId);
      const data = nodeData?.data as TreeDataNode["data"] | undefined;
      const canCollapse =
        (data?.isFile && data?.hasChildren) ||
        (data?.isH1 && data?.hasChildren) ||
        (data?.isH2 && data?.hasLinks) ||
        (data?.isLink && data?.hasChildren);
      const canOpen = data?.isLink || (data?.isH2 && !data?.hasLinks) || data?.isFile || data?.isH1;
      const modifier = e.ctrlKey || e.metaKey || e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey;
      if (modifier && canOpen && data) {
        handleNodeClick(nodeId, data);
      } else if (canCollapse) {
        toggleCollapse(nodeId);
      } else if (data) {
        handleNodeClick(nodeId, data);
      }
    };

    graph.on("node:click", handleClick as (evt: unknown) => void);

    graphRef.current = graph;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current && graphRef.current && !graphRef.current.destroyed) {
        graphRef.current.setSize(containerRef.current.offsetWidth, containerRef.current.offsetHeight);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      graph.off("node:click", handleClick);
      graph.destroy();
      graphRef.current = null;
    };
  }, [outline, collapsedIds, layoutDirection, handleNodeClick, toggleCollapse]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 shrink-0 pb-2">
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
        <div className="flex items-center gap-2 shrink-0 pb-2">
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
        <div className="flex items-center gap-2 shrink-0 pb-2">
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
          onClick={toggleLayoutDirection}
          title={layoutDirection === "H" ? "横向布局（文件多时较宽），点击切换为纵向" : "纵向布局（文件上下排列），点击切换为横向"}
        >
          {layoutDirection === "H" ? "横向" : "纵向"}
        </button>
        <span className="text-sm text-gh-text-secondary">
          思维导图：以文件为根；孤节点独立成图；链接可多级展开；按文档着色；可折叠节点点击切换，Ctrl/Cmd+点击打开
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" style={{ minHeight: 300 }} />
    </div>
  );
}
