import type { Group } from "../hooks/useApi";

export function allFileIds(groups: Group[]): Set<number> {
  const ids = new Set<number>();
  for (const g of groups) {
    for (const f of g.files) {
      ids.add(f.id);
    }
  }
  return ids;
}

export function parseGroupFromPath(pathname: string): string {
  const path = pathname.replace(/^\//, "").replace(/\/$/, "");
  return path || "default";
}

export function groupToPath(groupName: string): string {
  return groupName === "default" ? "/" : `/${groupName}`;
}

export function buildFileUrl(groupName: string, fileId: number): string {
  return `${groupToPath(groupName)}?file=${fileId}`;
}

export function parseFileIdFromSearch(search: string): number | null {
  const params = new URLSearchParams(search);
  const raw = params.get("file");
  if (raw == null) return null;
  const id = parseInt(raw, 10);
  return id > 0 ? id : null;
}
