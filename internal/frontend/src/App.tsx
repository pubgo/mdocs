import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { MarkdownViewer } from "./components/MarkdownViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { WidthToggle } from "./components/WidthToggle";
import { GroupDropdown } from "./components/GroupDropdown";
import { ViewModeToggle, type ViewMode } from "./components/ViewModeToggle";
import { SearchToggle } from "./components/SearchToggle";
import { RestartButton } from "./components/RestartButton";
import { DropOverlay } from "./components/DropOverlay";
import { TocPanel } from "./components/TocPanel";
import type { TocHeading } from "./components/TocPanel";
import { GraphView } from "./components/GraphView";
import { useSSE } from "./hooks/useSSE";
import { useFileDrop } from "./hooks/useFileDrop";
import { useActiveHeading } from "./hooks/useActiveHeading";
import { useScrollRestoration, SCROLL_SESSION_KEY } from "./hooks/useScrollRestoration";
import type { Group, Status } from "./hooks/useApi";
import { fetchGroups, fetchStatus, removeFile, removePattern, reorderFiles } from "./hooks/useApi";
import { allFileIds, parseGroupFromPath, parseFileIdFromSearch, groupToPath, buildFileUrl } from "./utils/groups";
import { getAllFileIdsUnder, type TreeNode } from "./utils/buildTree";
import { OutlineGraphView } from "./components/OutlineGraphView";

const VIEWMODE_STORAGE_KEY = "mo-sidebar-viewmode";
const WIDTH_STORAGE_KEY = "mo-layout-width";

export function App() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<string>(
    () => parseGroupFromPath(window.location.pathname) || "default",
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [contentRevision, setContentRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [viewModes, setViewModes] = useState<Record<string, ViewMode>>(() => {
    try {
      const stored = localStorage.getItem(VIEWMODE_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return {};
  });
  const [isWide, setIsWide] = useState(() => {
    try {
      return localStorage.getItem(WIDTH_STORAGE_KEY) === "wide";
    } catch {
      return false;
    }
  });
  const [showGraph, setShowGraph] = useState(false);
  const [graphViewMode, setGraphViewMode] = useState<"link" | "outline">("link");
  const [status, setStatus] = useState<Status | null>(null);
  const knownFileIds = useRef<Set<string>>(new Set());
  const [initialFileId, setInitialFileId] = useState<string | null>(() => {
    const fromUrl = parseFileIdFromSearch(window.location.search);
    if (fromUrl) return fromUrl;
    // Restore active file from scroll context saved before reload
    try {
      const stored = sessionStorage.getItem(SCROLL_SESSION_KEY);
      if (stored) {
        const ctx = JSON.parse(stored);
        if (ctx.url === window.location.pathname && ctx.fileId) return ctx.fileId;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

  // Track previous values for render-time state adjustment
  const [prevGroups, setPrevGroups] = useState<Group[]>([]);
  const [prevActiveGroup, setPrevActiveGroup] = useState(activeGroup);

  // Adjust derived state during render when groups or activeGroup changes
  if (groups !== prevGroups || activeGroup !== prevActiveGroup) {
    setPrevGroups(groups);
    setPrevActiveGroup(activeGroup);

    // Active file selection and sidebar auto open/close
    const group = groups.find((g) => g.name === activeGroup);
    setSidebarOpen(group != null && group.files.length >= 2);

    if (groups.length === 0) {
      setActiveFileId(null);
    } else if (!group) {
      const sortedGroups = [...groups].sort((a, b) => {
        if (a.name === "default") return 1;
        if (b.name === "default") return -1;
        return a.name.localeCompare(b.name);
      });
      setActiveGroup(sortedGroups[0].name);
    } else if (group.files.length === 0) {
      setActiveFileId(null);
    } else if (initialFileId != null) {
      setInitialFileId(null);
      setActiveFileId(
        group.files.some((f) => f.id === initialFileId) ? initialFileId : group.files[0].id,
      );
    } else {
      setActiveFileId((prev) => {
        if (group.files.some((f) => f.id === prev)) return prev;
        return group.files[0].id;
      });
    }
  }

  const loadGroups = useCallback(async () => {
    try {
      const [data, statusData] = await Promise.all([fetchGroups(), fetchStatus()]);
      setStatus(statusData);
      const newIds = allFileIds(data);
      const wasEmpty = knownFileIds.current.size === 0;
      const added: string[] = [];
      for (const id of newIds) {
        if (!knownFileIds.current.has(id)) {
          added.push(id);
        }
      }
      knownFileIds.current = newIds;

      setGroups(data);
      if (added.length > 0 && !wasEmpty) {
        // Only auto-select if the new file belongs to the current active group
        setActiveGroup((currentGroup) => {
          const group = data.find((g) => g.name === currentGroup);
          if (group) {
            const addedSet = new Set(added);
            const matched = group.files.filter((f) => addedSet.has(f.id));
            if (matched.length > 0) {
              setActiveFileId(matched[matched.length - 1].id);
            }
          }
          return currentGroup;
        });
      }
    } catch {
      // server may not be ready yet
    }
  }, []);

  // Initial data fetch (setState inside .then() is async, not flagged by linter)
  useEffect(() => {
    Promise.all([fetchGroups(), fetchStatus()])
      .then(([data, statusData]) => {
        knownFileIds.current = allFileIds(data);
        setGroups(data);
        setStatus(statusData);
      })
      .catch(() => {});
  }, []);

  // Sync URL with active group (and ?file= when a file is selected, e.g. after opening from graph)
  useEffect(() => {
    const targetUrl = activeFileId
      ? buildFileUrl(activeGroup, activeFileId)
      : groupToPath(activeGroup);
    const current = window.location.pathname + (window.location.search || "");
    if (current !== targetUrl) {
      window.history.replaceState(null, "", targetUrl);
    }
  }, [activeGroup, activeFileId]);

  // Clear search params after consuming initial file ID (don't clear when a file is selected, e.g. from graph)
  useEffect(() => {
    if (initialFileId === null && window.location.search && !activeFileId) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [initialFileId, activeFileId]);

  const activeFileName = useMemo(
    () =>
      groups.find((g) => g.name === activeGroup)?.files.find((f) => f.id === activeFileId)?.name ??
      "",
    [groups, activeGroup, activeFileId],
  );

  useEffect(() => {
    document.title = activeFileName || "mo";
  }, [activeFileName]);

  useSSE({
    onUpdate: () => {
      loadGroups();
    },
    onFileChanged: (fileId) => {
      captureScrollPosition();
      setActiveFileId((current) => {
        if (current === fileId) {
          setContentRevision((r) => r + 1);
        }
        return current;
      });
    },
  });

  const { isDragging } = useFileDrop(activeGroup);

  const currentViewMode: ViewMode = viewModes[activeGroup] ?? "flat";

  useEffect(() => {
    localStorage.setItem(VIEWMODE_STORAGE_KEY, JSON.stringify(viewModes));
  }, [viewModes]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, isWide ? "wide" : "narrow");
    } catch {
      /* ignore */
    }
  }, [isWide]);

  const handleViewModeToggle = useCallback(() => {
    setViewModes((prev) => {
      const current = prev[activeGroup] ?? "flat";
      const nextMode: ViewMode = current === "flat" ? "tree" : "flat";
      return { ...prev, [activeGroup]: nextMode };
    });
  }, [activeGroup]);

  const handleSearchToggle = useCallback(() => {
    setSearchQuery((prev) => (prev != null ? null : ""));
  }, []);

  const handleGroupChange = (name: string) => {
    setActiveGroup(name);
    setActiveFileId(null);
    window.history.pushState(null, "", groupToPath(name));
  };

  const handleFileOpened = useCallback((fileId: string) => {
    setActiveFileId(fileId);
  }, []);

  const handleRemoveFile = useCallback(() => {
    if (activeFileId != null) {
      removeFile(activeFileId);
    }
  }, [activeFileId]);

  const handleFilesReorder = useCallback((groupName: string, fileIds: string[]) => {
    // Optimistic update
    setGroups((prev) =>
      prev.map((g) => {
        if (g.name !== groupName) return g;
        const idToFile = new Map(g.files.map((f) => [f.id, f]));
        const reordered = fileIds
          .map((id) => idToFile.get(id))
          .filter((f): f is NonNullable<typeof f> => f != null);
        return { ...g, files: reordered };
      }),
    );
    reorderFiles(groupName, fileIds);
  }, []);

  const groupPatterns = useMemo(
    () => status?.groups?.find((g) => g.name === activeGroup)?.patterns ?? [],
    [status, activeGroup],
  );

  const handleRemovePattern = useCallback(
    async (pattern: string) => {
      await removePattern(pattern, activeGroup);
      loadGroups();
    },
    [activeGroup, loadGroups],
  );

  const handleRemoveFolder = useCallback(
    async (node: TreeNode) => {
      const ids = getAllFileIdsUnder(node);
      for (const id of ids) {
        await removeFile(id);
      }
      loadGroups();
    },
    [loadGroups],
  );

  const headingIds = useMemo(() => headings.map((h) => h.id), [headings]);

  const activeHeadingId = useActiveHeading(headingIds, scrollContainer);

  const { captureScrollPosition, onContentRendered } = useScrollRestoration(
    scrollContainer,
    activeHeadingId,
    activeFileId,
  );

  const handleHeadingClick = useCallback((id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="flex flex-col h-full font-sans text-gh-text bg-gh-bg">
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 bg-gh-header-bg text-gh-header-text border-b border-gh-header-border">
        <button
          type="button"
          className="flex items-center justify-center bg-transparent border border-gh-border rounded-md p-1.5 cursor-pointer text-gh-header-text transition-colors duration-150 hover:bg-gh-bg-hover"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Sidebar"
          aria-expanded={sidebarOpen}
          title="Toggle sidebar"
        >
          <svg
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <rect x="2" y="3" width="20" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
            {sidebarOpen ? (
              <polyline points="6,10 4,12 6,14" />
            ) : (
              <polyline points="5,10 7,12 5,14" />
            )}
          </svg>
        </button>
        <GroupDropdown
          groups={groups}
          activeGroup={activeGroup}
          onGroupChange={handleGroupChange}
        />
        <ViewModeToggle viewMode={currentViewMode} onToggle={handleViewModeToggle} />
        <SearchToggle isOpen={searchQuery != null} onToggle={handleSearchToggle} />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={`flex items-center justify-center rounded-md p-1.5 cursor-pointer transition-colors duration-150 border ${
              showGraph && graphViewMode === "link" ? "bg-gh-bg-hover border-gh-border" : "bg-transparent border-gh-border hover:bg-gh-bg-hover"
            } text-gh-header-text`}
            onClick={() => {
              setGraphViewMode("link");
              setShowGraph(true);
            }}
            aria-label="Link graph"
            aria-pressed={showGraph && graphViewMode === "link"}
            title="链接关系图"
          >
            <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </button>
          <button
            type="button"
            className={`flex items-center justify-center rounded-md p-1.5 cursor-pointer transition-colors duration-150 border ${
              showGraph && graphViewMode === "outline" ? "bg-gh-bg-hover border-gh-border" : "bg-transparent border-gh-border hover:bg-gh-bg-hover"
            } text-gh-header-text`}
            onClick={() => {
              setGraphViewMode("outline");
              setShowGraph(true);
            }}
            aria-label="Outline graph"
            aria-pressed={showGraph && graphViewMode === "outline"}
            title="标题结构图"
          >
            <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10h6V7H3zm0-4h18M9 11h12M9 15h12M9 19h12" />
            </svg>
          </button>
          <WidthToggle isWide={isWide} onToggle={() => setIsWide((v) => !v)} />
          <ThemeToggle />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            groups={groups}
            activeGroup={activeGroup}
            activeFileId={activeFileId}
            groupPatterns={groupPatterns}
            onRemovePattern={handleRemovePattern}
            onRemoveFolder={handleRemoveFolder}
            onFileSelect={setActiveFileId}
            onFilesReorder={handleFilesReorder}
            viewMode={currentViewMode}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        )}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div ref={setScrollContainer} className="flex-1 overflow-y-auto p-8 bg-gh-bg">
            {showGraph ? (
              graphViewMode === "outline" ? (
                <OutlineGraphView onClose={() => setShowGraph(false)} />
              ) : (
                <GraphView onClose={() => setShowGraph(false)} />
              )
            ) : activeFileId != null ? (
              <MarkdownViewer
                fileId={activeFileId}
                fileName={activeFileName}
                revision={contentRevision}
                onFileOpened={handleFileOpened}
                onHeadingsChange={setHeadings}
                onContentRendered={onContentRendered}
                isTocOpen={tocOpen}
                onTocToggle={() => setTocOpen((v) => !v)}
                onRemoveFile={handleRemoveFile}
                isWide={isWide}
              />
            ) : (
              <div className="flex items-center justify-center h-50 text-gh-text-secondary text-sm">
                No file selected
              </div>
            )}
          </div>
        </main>
        {tocOpen && (
          <TocPanel
            headings={headings}
            activeHeadingId={activeHeadingId}
            onHeadingClick={handleHeadingClick}
          />
        )}
      </div>
      <RestartButton />
      {isDragging && <DropOverlay />}
    </div>
  );
}
