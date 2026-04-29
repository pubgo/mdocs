/**
 * Static data layer: when the SPA is exported as a static site, the server
 * injects `window.__MO_STATIC_DATA__` containing all groups, file contents,
 * raw assets (base64), graph, and outline data. This module detects that
 * data and provides it to the rest of the app so no API calls are needed.
 */

import type { Group, FileContent, LinkGraph, Outline, VersionInfo } from "../hooks/useApi";

interface StaticRawAsset {
    data: string;     // base64
    mimeType: string;
}

interface StaticDataPayload {
    groups: Group[];
    contents: Record<string, FileContent>;
    rawAssets: Record<string, Record<string, StaticRawAsset>>;  // fileID -> path -> asset
    graph: LinkGraph;
    outline: Outline;
    version: VersionInfo;
}

declare global {
    interface Window {
        __MO_STATIC_DATA__?: StaticDataPayload;
    }
}

let _staticData: StaticDataPayload | null = null;

/** Returns true if we're running in static/exported mode. */
export function isStaticMode(): boolean {
    if (_staticData !== null) return true;
    if (window.__MO_STATIC_DATA__) {
        _staticData = window.__MO_STATIC_DATA__;
        return true;
    }
    return false;
}

export function getStaticData(): StaticDataPayload | null {
    if (_staticData) return _staticData;
    if (window.__MO_STATIC_DATA__) {
        _staticData = window.__MO_STATIC_DATA__;
        return _staticData;
    }
    return null;
}

export function getStaticGroups(): Group[] {
    return getStaticData()?.groups ?? [];
}

export function getStaticFileContent(fileId: string): FileContent | null {
    return getStaticData()?.contents[fileId] ?? null;
}

export function getStaticGraph(): LinkGraph | null {
    return getStaticData()?.graph ?? null;
}

export function getStaticOutline(): Outline | null {
    return getStaticData()?.outline ?? null;
}

export function getStaticVersion(): VersionInfo | null {
    return getStaticData()?.version ?? null;
}

/**
 * Get a raw asset as a data: URI for use in <img> src.
 * Returns null if not available (will fall back to normal API URL).
 */
export function getStaticRawAssetUrl(fileId: string, relativePath: string): string | null {
    const data = getStaticData();
    if (!data) return null;
    const fileAssets = data.rawAssets[fileId];
    if (!fileAssets) return null;
    const asset = fileAssets[relativePath];
    if (!asset) return null;
    return `data:${asset.mimeType};base64,${asset.data}`;
}
