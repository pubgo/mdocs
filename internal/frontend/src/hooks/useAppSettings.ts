import { useCallback, useSyncExternalStore } from "react";

/**
 * Unified localStorage-backed store.
 *
 * All mo-prefixed settings consolidated into a single JSON blob
 * (`mo-settings`), read/written atomically. Individual component
 * stores (sidebar width, toc width, etc.) remain independent because
 * they change at high frequency during drag-resize. This store is
 * for discrete preference values.
 */

const STORAGE_KEY = "mo-app-settings";

export interface AppSettings {
    sidebarViewModes: Record<string, string>;  // group → "flat" | "tree"
    layoutWidth: "narrow" | "wide";
    tocCollapsed: string[];                     // collapsed heading IDs
    outlineGraphDirection: string;
    outlineLayoutDirection: string;
}

export const APP_SETTINGS_DEFAULTS: AppSettings = {
    sidebarViewModes: {},
    layoutWidth: "narrow",
    tocCollapsed: [],
    outlineGraphDirection: "LR",
    outlineLayoutDirection: "LR",
};

let listeners: Array<() => void> = [];
let cached: AppSettings | null = null;

function read(): AppSettings {
    if (cached) return cached;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            cached = { ...APP_SETTINGS_DEFAULTS, ...JSON.parse(raw) };
            return cached!;
        }
    } catch { /* ignore */ }
    cached = { ...APP_SETTINGS_DEFAULTS };
    return cached;
}

function write(settings: AppSettings) {
    cached = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners = [...listeners, listener];
    return () => {
        listeners = listeners.filter((l) => l !== listener);
    };
}

function getSnapshot(): AppSettings {
    return read();
}

export function useAppSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
    const settings = useSyncExternalStore(subscribe, getSnapshot);

    const update = useCallback((patch: Partial<AppSettings>) => {
        const current = read();
        write({ ...current, ...patch });
    }, []);

    return [settings, update];
}

/** Read synchronously outside React */
export function getAppSettings(): AppSettings {
    return read();
}
