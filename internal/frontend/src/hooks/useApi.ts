import { isStaticMode, getStaticGroups, getStaticFileContent, getStaticGraph, getStaticOutline, getStaticVersion } from "../utils/staticData";

export interface FileEntry {
  name: string;
  id: string;
  path: string;
  uploaded?: boolean;
}

export interface Group {
  name: string;
  files: FileEntry[];
}

export interface FileContent {
  content: string;
  baseDir: string;
}

export interface VersionInfo {
  version: string;
  revision: string;
}

export interface GraphNode {
  id: string;
  name: string;
  path?: string;
  group?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  heading?: string;
}

export interface LinkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchGraph(): Promise<LinkGraph> {
  if (isStaticMode()) {
    const graph = getStaticGraph();
    if (graph) return graph;
  }
  const res = await fetch("/_/api/graph");
  if (!res.ok) throw new Error("Failed to fetch graph");
  return res.json();
}

export interface OutlineLinkedFile {
  fileId: string;
  label?: string;
}

export interface OutlineHeading {
  level: number;
  text: string;
  linkedFiles?: OutlineLinkedFile[];
  linkedFileIds?: string[];
}

export interface OutlineNode {
  id: string;
  name: string;
  group: string;
  path?: string;
  headings: OutlineHeading[];
}

export interface Outline {
  files: OutlineNode[];
}

export async function fetchOutline(): Promise<Outline> {
  if (isStaticMode()) {
    const outline = getStaticOutline();
    if (outline) return outline;
  }
  const res = await fetch("/_/api/outline");
  if (!res.ok) throw new Error("Failed to fetch outline");
  return res.json();
}

export async function fetchGroups(): Promise<Group[]> {
  if (isStaticMode()) return getStaticGroups();
  const res = await fetch("/_/api/groups");
  if (!res.ok) throw new Error("Failed to fetch groups");
  return res.json();
}

export async function fetchFileContent(id: string): Promise<FileContent> {
  if (isStaticMode()) {
    const content = getStaticFileContent(id);
    if (content) return content;
    throw new Error("File not found in static data");
  }
  const res = await fetch(`/_/api/files/${id}/content`);
  if (!res.ok) throw new Error("Failed to fetch file content");
  return res.json();
}

export async function openRelativeFile(fileId: string, relativePath: string): Promise<FileEntry> {
  const res = await fetch("/_/api/files/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, path: relativePath }),
  });
  if (!res.ok) throw new Error("Failed to open file");
  return res.json();
}

export async function removeFile(id: string): Promise<void> {
  const res = await fetch(`/_/api/files/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove file");
}

export async function reorderFiles(groupName: string, fileIds: string[]): Promise<void> {
  const res = await fetch("/_/api/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group: groupName, fileIds }),
  });
  if (!res.ok) throw new Error("Failed to reorder files");
}

export async function moveFile(id: string, group: string): Promise<void> {
  const res = await fetch(`/_/api/files/${id}/group`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.trim() || "Failed to move file");
  }
}

export async function uploadFile(name: string, content: string, group: string): Promise<void> {
  const res = await fetch("/_/api/files/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content, group }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.trim() || "Failed to upload file");
  }
}

export async function restartServer(): Promise<void> {
  const res = await fetch("/_/api/restart", { method: "POST" });
  if (!res.ok) throw new Error("Failed to restart server");
}

export async function fetchVersion(): Promise<VersionInfo> {
  if (isStaticMode()) {
    const ver = getStaticVersion();
    if (ver) return ver;
  }
  const res = await fetch("/_/api/version");
  if (!res.ok) throw new Error("Failed to fetch version");
  return res.json();
}

export interface StatusGroup {
  name: string;
  files: FileEntry[];
  patterns?: string[];
}

export interface Status {
  version: string;
  revision: string;
  pid: number;
  groups: StatusGroup[];
}

export async function fetchStatus(): Promise<Status> {
  if (isStaticMode()) {
    const ver = getStaticVersion();
    const groups = getStaticGroups();
    return {
      version: ver?.version ?? "",
      revision: ver?.revision ?? "",
      pid: 0,
      groups: groups.map((g) => ({ name: g.name, files: g.files })),
    };
  }
  const res = await fetch("/_/api/status");
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

export async function removePattern(pattern: string, group: string): Promise<void> {
  const res = await fetch("/_/api/patterns", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pattern, group }),
  });
  if (!res.ok) throw new Error("Failed to remove pattern");
}
