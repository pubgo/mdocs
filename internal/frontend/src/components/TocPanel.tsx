import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

interface TocPanelProps {
  headings: TocHeading[];
  activeHeadingId: string | null;
  onHeadingClick: (id: string) => void;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;
const STORAGE_KEY = "mo-toc-width";
const COLLAPSED_KEY = "mo-toc-collapsed";

function getInitialWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  }
  return DEFAULT_WIDTH;
}

function getInitialCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore */ }
  return new Set();
}

const INDENT: Record<number, string> = {
  1: "pl-3",
  2: "pl-6",
  3: "pl-9",
  4: "pl-12",
  5: "pl-15",
  6: "pl-18",
};

const LEVEL_BADGE: Record<number, string> = {
  1: "H1",
  2: "H2",
  3: "H3",
  4: "H4",
  5: "H5",
  6: "H6",
};

/** Check if a heading has children (any heading with a deeper level before the next same-or-higher level heading) */
function hasChildren(headings: TocHeading[], index: number): boolean {
  const current = headings[index];
  for (let i = index + 1; i < headings.length; i++) {
    if (headings[i].level <= current.level) break;
    return true;
  }
  return false;
}

/** Get indices of headings that are hidden because a parent is collapsed */
function getHiddenIndices(headings: TocHeading[], collapsed: Set<string>): Set<number> {
  const hidden = new Set<number>();
  let skipUntilLevel = Infinity;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h.level <= skipUntilLevel) {
      skipUntilLevel = Infinity;
    }
    if (h.level > skipUntilLevel) {
      // still inside collapsed parent
    } else if (collapsed.has(h.id) && hasChildren(headings, i)) {
      skipUntilLevel = h.level;
    }
    if (h.level > skipUntilLevel) {
      hidden.add(i);
    }
  }
  return hidden;
}

export function TocPanel({ headings, activeHeadingId, onHeadingClick }: TocPanelProps) {
  const [width, setWidth] = useState(getInitialWidth);
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const dragging = useRef(false);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const hiddenIndices = useMemo(() => getHiddenIndices(headings, collapsed), [headings, collapsed]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
      setWidth(clamped);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  return (
    <aside
      className="relative shrink-0 bg-gh-bg-sidebar border-l border-gh-border flex flex-col overflow-y-auto"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-gh-border active:bg-gh-border transition-colors"
        onMouseDown={onMouseDown}
      />
      <nav className="flex flex-col pb-1">
        {headings.length === 0 ? (
          <div className="px-3 py-2 text-gh-text-secondary text-sm">No headings</div>
        ) : (
          headings.map((h, idx) => {
            if (hiddenIndices.has(idx)) return null;
            const expandable = hasChildren(headings, idx);
            const isCollapsed = collapsed.has(h.id);
            return (
              <div key={h.id} className="flex items-center w-full group">
                {/* Collapse toggle */}
                <button
                  type="button"
                  className={`shrink-0 w-4 h-4 ml-0.5 flex items-center justify-center text-gh-text-secondary transition-colors ${expandable ? "cursor-pointer hover:text-gh-text" : "invisible"
                    }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (expandable) toggleCollapse(h.id);
                  }}
                  tabIndex={-1}
                  aria-label={isCollapsed ? "展开" : "折叠"}
                >
                  {expandable && (
                    <svg
                      className={`size-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M6 4l8 6-8 6V4z" />
                    </svg>
                  )}
                </button>
                {/* Heading button */}
                <button
                  className={`flex items-center gap-1.5 flex-1 min-w-0 ${INDENT[h.level] ?? "pl-3"} pr-3 py-1.5 border-none cursor-pointer text-left text-sm transition-colors duration-150 ${h.id === activeHeadingId
                      ? "bg-gh-bg-active text-gh-text font-semibold"
                      : "bg-transparent text-gh-text-secondary hover:bg-gh-bg-hover"
                    }`}
                  onClick={() => onHeadingClick(h.id)}
                  title={`${LEVEL_BADGE[h.level] ?? "H?"} — ${h.text}`}
                >
                  <span className="shrink-0 text-[10px] leading-none opacity-50 font-mono">{LEVEL_BADGE[h.level]}</span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{h.text}</span>
                </button>
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );
}
