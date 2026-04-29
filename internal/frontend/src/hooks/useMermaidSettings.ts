import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "mo-mermaid-settings";

export interface MermaidSettings {
    nodeSpacing: number;
    layerSpacing: number;
    thoroughness: number;
    padding: number;
    theme: "custom" | "github-light" | "github-dark" | "auto" | "high-contrast" | "tokyo-night" | "nord";
    preset: string;
}

export const MERMAID_SETTINGS_DEFAULTS: MermaidSettings = {
    nodeSpacing: 32,
    layerSpacing: 56,
    thoroughness: 5,
    padding: 40,
    theme: "custom",
    preset: "balanced",
};

export interface MermaidPreset {
    key: string;
    label: string;
    description: string;
    settings: Omit<MermaidSettings, "preset">;
}

export const MERMAID_PRESETS: MermaidPreset[] = [
    {
        key: "compact",
        label: "紧凑",
        description: "适合简单图，节点紧凑",
        settings: { nodeSpacing: 16, layerSpacing: 32, thoroughness: 3, padding: 24, theme: "auto" },
    },
    {
        key: "balanced",
        label: "均衡 (推荐)",
        description: "适合大多数图表",
        settings: { nodeSpacing: 32, layerSpacing: 56, thoroughness: 5, padding: 40, theme: "auto" },
    },
    {
        key: "spacious",
        label: "宽松",
        description: "复杂图更清晰，线条整齐",
        settings: { nodeSpacing: 48, layerSpacing: 72, thoroughness: 6, padding: 48, theme: "auto" },
    },
    {
        key: "ultra-clear",
        label: "超清晰",
        description: "极大间距 + 最高优化，适合展示",
        settings: { nodeSpacing: 64, layerSpacing: 96, thoroughness: 7, padding: 56, theme: "high-contrast" },
    },
];

let listeners: Array<() => void> = [];
let cachedSettings: MermaidSettings | null = null;

// Global revision counter — incremented when user clicks "apply"
let settingsRevision = 0;
let revisionListeners: Array<() => void> = [];

function readFromStorage(): MermaidSettings {
    if (cachedSettings) return cachedSettings;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            cachedSettings = { ...MERMAID_SETTINGS_DEFAULTS, ...parsed };
            return cachedSettings!;
        }
    } catch {
        // ignore
    }
    cachedSettings = { ...MERMAID_SETTINGS_DEFAULTS };
    return cachedSettings;
}

function writeToStorage(settings: MermaidSettings) {
    cachedSettings = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners = [...listeners, listener];
    return () => {
        listeners = listeners.filter((l) => l !== listener);
    };
}

function getSnapshot(): MermaidSettings {
    return readFromStorage();
}

export function useMermaidSettings(): [MermaidSettings, (patch: Partial<MermaidSettings>) => void, () => void] {
    const settings = useSyncExternalStore(subscribe, getSnapshot);

    const update = useCallback((patch: Partial<MermaidSettings>) => {
        const current = readFromStorage();
        writeToStorage({ ...current, ...patch });
    }, []);

    const reset = useCallback(() => {
        writeToStorage({ ...MERMAID_SETTINGS_DEFAULTS });
    }, []);

    return [settings, update, reset];
}

/** Read settings synchronously (for use outside React components) */
export function getMermaidSettings(): MermaidSettings {
    return readFromStorage();
}

/** Notify subscribers to re-read (e.g. after renderBeautifulMermaid changes settings) */
export function invalidateMermaidSettingsCache() {
    cachedSettings = null;
    for (const listener of listeners) listener();
}

/** Bump the global settings revision — triggers all MermaidBlock re-renders */
export function bumpSettingsRevision() {
    settingsRevision += 1;
    for (const listener of revisionListeners) listener();
}

function subscribeRevision(listener: () => void) {
    revisionListeners = [...revisionListeners, listener];
    return () => {
        revisionListeners = revisionListeners.filter((l) => l !== listener);
    };
}

function getRevisionSnapshot(): number {
    return settingsRevision;
}

/** Subscribe to settings revision changes (for triggering re-renders) */
export function useMermaidSettingsRevision(): number {
    return useSyncExternalStore(subscribeRevision, getRevisionSnapshot);
}
