import type { FileEntry } from "../hooks/useApi";

/** Returns the common directory path of all filesystem files (empty if none). */
export function getCommonPrefixPath(files: FileEntry[]): string {
  const fsFiles = files.filter((f) => !f.uploaded);
  if (fsFiles.length === 0) return "";
  const segsList = fsFiles.map((f) => f.path.split("/").filter(Boolean).slice(0, -1));
  if (segsList.some((s) => s.length === 0)) return "";
  const first = segsList[0];
  let n = first.length;
  for (let i = 1; i < segsList.length; i++) {
    const s = segsList[i];
    for (let j = 0; j < n && j < s.length; j++) {
      if (s[j] !== first[j]) {
        n = j;
        break;
      }
    }
  }
  const common = first.slice(0, n);
  if (common.length === 0) return "";
  const joined = common.join("/");
  const isAbsolute = fsFiles[0].path.startsWith("/");
  return isAbsolute ? "/" + joined : joined;
}

/** Get the base directory of a glob pattern (path before any *). */
export function getPatternBaseDir(pattern: string): string {
  const normalized = pattern.replace(/\\/g, "/");
  const idx = normalized.indexOf("*");
  if (idx === -1) return normalized.replace(/\/+$/, "");
  return normalized.slice(0, idx).replace(/\/+$/, "");
}

/** Collect all file IDs in the subtree under this node (for folder: all descendant files). */
export function getAllFileIdsUnder(node: TreeNode): string[] {
  if (node.file != null) return [node.file.id];
  const ids: string[] = [];
  for (const child of node.children) {
    ids.push(...getAllFileIdsUnder(child));
  }
  return ids;
}

export interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  file: FileEntry | null;
}

export function buildTree(files: FileEntry[]): TreeNode {
  if (files.length === 0) {
    return { name: "", fullPath: "", children: [], file: null };
  }

  // Separate uploaded files from filesystem files
  const fsFiles = files.filter((f) => !f.uploaded);
  const uploadedFiles = files.filter((f) => f.uploaded);

  if (fsFiles.length === 0) {
    // All files are uploaded — flat list at root
    const root: TreeNode = { name: "", fullPath: "", children: [], file: null };
    for (const file of uploadedFiles) {
      root.children.push({
        name: file.name,
        fullPath: `uploaded:${file.id}`,
        children: [],
        file,
      });
    }
    sortTree(root);
    return root;
  }

  // Split each file path into segments once
  const splitPaths = fsFiles.map((f) => f.path.split("/"));
  const dirSegmentsList = splitPaths.map((parts) => parts.slice(0, -1));

  // Find common prefix among directory parts
  const commonPrefix = findCommonPrefix(dirSegmentsList);
  const prefixLen = commonPrefix.length;

  // Build a trie from relative paths
  const root: TreeNode = { name: "", fullPath: "", children: [], file: null };

  for (let fi = 0; fi < fsFiles.length; fi++) {
    const file = fsFiles[fi];
    const parts = splitPaths[fi];
    const dirParts = parts.slice(prefixLen, -1); // relative dir segments
    let current = root;

    for (const segment of dirParts) {
      let child = current.children.find((c) => c.file == null && c.name === segment);
      if (!child) {
        child = {
          name: segment,
          fullPath: current.fullPath ? `${current.fullPath}/${segment}` : segment,
          children: [],
          file: null,
        };
        current.children.push(child);
      }
      current = child;
    }

    current.children.push({
      name: file.name,
      fullPath: current.fullPath ? `${current.fullPath}/${file.name}` : file.name,
      children: [],
      file,
    });
  }

  // When all files are in the same directory, root has only file children and no folder row.
  // Wrap them in a single folder node so the user sees one folder with a remove button.
  if (
    commonPrefix.length > 0 &&
    root.children.length > 0 &&
    root.children.every((c) => c.file != null && !c.file.uploaded)
  ) {
    const folderName = commonPrefix[commonPrefix.length - 1];
    const folderNode: TreeNode = {
      name: folderName,
      fullPath: folderName,
      children: [...root.children],
      file: null,
    };
    root.children = [folderNode];
  }

  // Add uploaded files at root level
  for (const file of uploadedFiles) {
    root.children.push({
      name: file.name,
      fullPath: `uploaded:${file.id}`,
      children: [],
      file,
    });
  }

  // Collapse single-child directory nodes
  collapseSingleChild(root);

  // Sort: directories first, then alphabetical
  sortTree(root);

  return root;
}

/** Flattens a tree into file entries using the same visual order as TreeView. */
export function flattenTreeFiles(node: TreeNode): FileEntry[] {
  const result: FileEntry[] = [];

  const walk = (current: TreeNode) => {
    if (current.file != null) {
      result.push(current.file);
      return;
    }
    for (const child of current.children) {
      walk(child);
    }
  };

  walk(node);
  return result;
}

function findCommonPrefix(segmentsList: string[][]): string[] {
  if (segmentsList.length === 0) return [];
  const first = segmentsList[0];
  let len = first.length;
  for (let i = 1; i < segmentsList.length; i++) {
    len = Math.min(len, segmentsList[i].length);
    for (let j = 0; j < len; j++) {
      if (first[j] !== segmentsList[i][j]) {
        len = j;
        break;
      }
    }
  }
  return first.slice(0, len);
}

function collapseSingleChild(node: TreeNode): void {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    // Collapse chain: directory with exactly one child that is also a directory
    while (child.file == null && child.children.length === 1 && child.children[0].file == null) {
      const grandchild = child.children[0];
      child = {
        name: `${child.name}/${grandchild.name}`,
        fullPath: grandchild.fullPath,
        children: grandchild.children,
        file: null,
      };
    }
    node.children[i] = child;
    collapseSingleChild(child);
  }
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    const aIsDir = a.file == null;
    const bIsDir = b.file == null;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    sortTree(child);
  }
}
