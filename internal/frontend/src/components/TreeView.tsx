import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileEntry, Group } from "../hooks/useApi";
import { buildTree, getCommonPrefixPath, getPatternBaseDir, type TreeNode } from "../utils/buildTree";
import { FileContextMenu } from "./FileContextMenu";
import { FileIcon } from "./FileIcon";

const COLLAPSED_STORAGE_KEY = "mo-sidebar-tree-collapsed";

function getInitialCollapsed(group: string): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed[group]) return new Set(parsed[group]);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

interface TreeViewProps {
  files: FileEntry[];
  activeGroup: string;
  groupPatterns: string[];
  activeFileId: string | null;
  menuOpenId: string | null;
  otherGroups: Group[];
  readOnly?: boolean;
  onFileSelect: (id: string) => void;
  onMenuToggle: (id: string) => void;
  onOpenInNewTab: (id: string) => void;
  onMoveToGroup: (id: string, group: string) => void;
  onRemove: (id: string) => void;
  onRemovePattern?: (pattern: string) => void;
  onRemoveFolder?: (node: TreeNode) => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}

export function TreeView({
  files,
  activeGroup,
  groupPatterns,
  activeFileId,
  menuOpenId,
  otherGroups,
  readOnly,
  onFileSelect,
  onMenuToggle,
  onOpenInNewTab,
  onMoveToGroup,
  onRemove,
  onRemovePattern,
  onRemoveFolder,
  menuRef,
}: TreeViewProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const commonPrefixPath = useMemo(() => getCommonPrefixPath(files), [files]);
  const [prevGroup, setPrevGroup] = useState(activeGroup);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() =>
    getInitialCollapsed(activeGroup),
  );

  if (prevGroup !== activeGroup) {
    setPrevGroup(activeGroup);
    setCollapsedPaths(getInitialCollapsed(activeGroup));
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      const all = stored ? JSON.parse(stored) : {};
      all[activeGroup] = [...collapsedPaths];
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  }, [collapsedPaths, activeGroup]);

  const handleToggleCollapse = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <>
      {tree.children.map((node) => (
        <TreeNodeItem
          key={node.fullPath}
          node={node}
          depth={0}
          activeGroup={activeGroup}
          groupPatterns={groupPatterns}
          commonPrefixPath={commonPrefixPath}
          activeFileId={activeFileId}
          menuOpenId={menuOpenId}
          otherGroups={otherGroups}
          readOnly={readOnly}
          onFileSelect={onFileSelect}
          onMenuToggle={onMenuToggle}
          onOpenInNewTab={onOpenInNewTab}
          onMoveToGroup={onMoveToGroup}
          onRemove={onRemove}
          onRemovePattern={onRemovePattern}
          onRemoveFolder={onRemoveFolder}
          menuRef={menuRef}
          collapsedPaths={collapsedPaths}
          onToggleCollapse={handleToggleCollapse}
        />
      ))}
    </>
  );
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  activeGroup: string;
  groupPatterns: string[];
  commonPrefixPath: string;
  activeFileId: string | null;
  menuOpenId: string | null;
  otherGroups: Group[];
  readOnly?: boolean;
  onFileSelect: (id: string) => void;
  onMenuToggle: (id: string) => void;
  onOpenInNewTab: (id: string) => void;
  onMoveToGroup: (id: string, group: string) => void;
  onRemove: (id: string) => void;
  onRemovePattern?: (pattern: string) => void;
  onRemoveFolder?: (node: TreeNode) => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  collapsedPaths: Set<string>;
  onToggleCollapse: (path: string) => void;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function findPatternForFolder(folderAbsPath: string, patterns: string[]): string | null {
  const normalized = normalizePath(folderAbsPath);
  for (const pattern of patterns) {
    const base = getPatternBaseDir(pattern);
    if (normalizePath(base) === normalized) return pattern;
  }
  return null;
}

function TreeNodeItem({
  node,
  depth,
  activeGroup,
  groupPatterns,
  commonPrefixPath,
  activeFileId,
  menuOpenId,
  otherGroups,
  readOnly,
  onFileSelect,
  onMenuToggle,
  onOpenInNewTab,
  onMoveToGroup,
  onRemove,
  onRemovePattern,
  onRemoveFolder,
  menuRef,
  collapsedPaths,
  onToggleCollapse,
}: TreeNodeItemProps) {
  if (node.file != null) {
    return (
      <FileNodeItem
        file={node.file}
        name={node.name}
        depth={depth}
        activeFileId={activeFileId}
        menuOpenId={menuOpenId}
        otherGroups={otherGroups}
        readOnly={readOnly}
        onFileSelect={onFileSelect}
        onMenuToggle={onMenuToggle}
        onOpenInNewTab={onOpenInNewTab}
        onMoveToGroup={onMoveToGroup}
        onRemove={onRemove}
        menuRef={menuRef}
      />
    );
  }

  const isCollapsed = collapsedPaths.has(node.fullPath);
  // When buildTree wraps same-dir files in one folder, that folder's fullPath is the last segment;
  // its absolute path is commonPrefixPath (not commonPrefixPath + fullPath).
  const lastSegment = commonPrefixPath.split("/").filter(Boolean).pop();
  const folderAbsPath =
    lastSegment && node.fullPath === lastSegment && !node.fullPath.includes("/")
      ? commonPrefixPath
      : commonPrefixPath + (commonPrefixPath && !commonPrefixPath.endsWith("/") ? "/" : "") + node.fullPath;
  const matchingPattern = findPatternForFolder(folderAbsPath, groupPatterns);
  const canRemove = !readOnly && (onRemovePattern != null || onRemoveFolder != null);

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (matchingPattern && onRemovePattern) {
      onRemovePattern(matchingPattern);
    } else if (onRemoveFolder) {
      onRemoveFolder(node);
    }
  };

  return (
    <div className="group/folder">
      <div
        className="flex items-center gap-0 w-full min-w-0"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <button
          className="flex items-center gap-1.5 flex-1 min-w-0 px-3 py-1.5 border-none cursor-pointer text-left text-sm bg-transparent text-gh-text-secondary hover:bg-gh-bg-hover transition-colors duration-150"
          onClick={() => onToggleCollapse(node.fullPath)}
        >
          {/* Chevron */}
          <svg
            className={`size-3 shrink-0 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M6.427 4.427l3.396 3.396a.25.25 0 0 1 0 .354l-3.396 3.396A.25.25 0 0 1 6 11.396V4.604a.25.25 0 0 1 .427-.177Z" />
          </svg>
          {/* Folder icon */}
          <svg className="size-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
            {isCollapsed ? (
              <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7Z" />
            ) : (
              <path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.2c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1h6.8A1.75 1.75 0 0 1 16 4.75v8.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237ZM1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 0 0-.2-.1Z" />
            )}
          </svg>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
        </button>
        {canRemove && (
          <button
            type="button"
            className="shrink-0 p-1.5 rounded border border-transparent text-gh-text-secondary hover:bg-gh-bg-hover hover:border-gh-border"
            onClick={handleRemoveClick}
            title={matchingPattern ? "移除对该文件夹的监听" : "从当前分组移除此文件夹下所有文件"}
            aria-label="移除"
          >
            <svg className="size-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        )}
      </div>
      {!isCollapsed &&
        node.children.map((child) => (
          <TreeNodeItem
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            activeGroup={activeGroup}
            groupPatterns={groupPatterns}
            commonPrefixPath={commonPrefixPath}
            activeFileId={activeFileId}
            menuOpenId={menuOpenId}
            otherGroups={otherGroups}
            readOnly={readOnly}
            onFileSelect={onFileSelect}
            onMenuToggle={onMenuToggle}
            onOpenInNewTab={onOpenInNewTab}
            onMoveToGroup={onMoveToGroup}
            onRemove={onRemove}
            onRemovePattern={onRemovePattern}
            onRemoveFolder={onRemoveFolder}
            menuRef={menuRef}
            collapsedPaths={collapsedPaths}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
    </div>
  );
}

interface FileNodeItemProps {
  file: FileEntry;
  name: string;
  depth: number;
  activeFileId: string | null;
  menuOpenId: string | null;
  otherGroups: Group[];
  readOnly?: boolean;
  onFileSelect: (id: string) => void;
  onMenuToggle: (id: string) => void;
  onOpenInNewTab: (id: string) => void;
  onMoveToGroup: (id: string, group: string) => void;
  onRemove: (id: string) => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}

function FileNodeItem({
  file,
  name,
  depth,
  activeFileId,
  menuOpenId,
  otherGroups,
  readOnly,
  onFileSelect,
  onMenuToggle,
  onOpenInNewTab,
  onMoveToGroup,
  onRemove,
  menuRef,
}: FileNodeItemProps) {
  const isActive = file.id === activeFileId;

  return (
    <div className="relative group/file">
      <button
        className={`flex items-center gap-2 w-full px-3 py-2 border-none cursor-pointer text-left text-sm transition-colors duration-150 ${isActive
            ? "bg-gh-bg-active text-gh-text font-semibold"
            : "bg-transparent text-gh-text-secondary hover:bg-gh-bg-hover"
          }`}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => onFileSelect(file.id)}
        title={file.uploaded ? file.name : file.path}
      >
        <FileIcon uploaded={file.uploaded} />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap pr-6">{name}</span>
      </button>
      {!readOnly && (
        <FileContextMenu
          file={file}
          isOpen={menuOpenId === file.id}
          otherGroups={otherGroups}
          onToggle={onMenuToggle}
          onOpenInNewTab={onOpenInNewTab}
          onMoveToGroup={onMoveToGroup}
          onRemove={onRemove}
          menuRef={menuRef}
        />
      )}
    </div>
  );
}
