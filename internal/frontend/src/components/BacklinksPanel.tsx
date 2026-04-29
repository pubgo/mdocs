import { useEffect, useState, useCallback } from "react";
import type { LinkGraph } from "../hooks/useApi";
import { fetchGraph } from "../hooks/useApi";
import { buildFileUrl, parseGroupFromPath } from "../utils/groups";

interface BacklinkEntry {
    fileId: string;
    fileName: string;
    group: string;
    label?: string;
    heading?: string;
}

interface BacklinksPanelProps {
    fileId: string;
}

export function BacklinksPanel({ fileId }: BacklinksPanelProps) {
    const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const activeGroup = parseGroupFromPath(window.location.pathname) || "default";

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchGraph()
            .then((graph: LinkGraph) => {
                if (cancelled) return;
                const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
                const incoming = graph.edges
                    .filter((e) => e.to === fileId && e.from !== fileId)
                    .map((e) => {
                        const node = nodeMap.get(e.from);
                        return {
                            fileId: e.from,
                            fileName: node?.name ?? e.from,
                            group: node?.group ?? "default",
                            label: e.label,
                            heading: e.heading,
                        };
                    });
                // Deduplicate by fileId
                const seen = new Set<string>();
                const unique = incoming.filter((b) => {
                    if (seen.has(b.fileId)) return false;
                    seen.add(b.fileId);
                    return true;
                });
                setBacklinks(unique);
                setLoading(false);
            })
            .catch(() => {
                if (!cancelled) {
                    setBacklinks([]);
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [fileId]);

    const handleClick = useCallback(
        (entry: BacklinkEntry) => {
            const url = buildFileUrl(entry.group, entry.fileId);
            if (entry.group === activeGroup) {
                // Same group: update URL in-place
                window.history.pushState(null, "", `${url}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
            } else {
                window.open(`${window.location.origin}${url}`, "_blank", "noopener,noreferrer");
            }
        },
        [activeGroup],
    );

    if (loading) return null;
    if (backlinks.length === 0) return null;

    return (
        <div className="mt-8 border-t border-gh-border pt-4">
            <button
                type="button"
                className="flex items-center gap-1.5 text-sm text-gh-text-secondary hover:text-gh-text-primary cursor-pointer bg-transparent border-0 p-0"
                onClick={() => setExpanded((v) => !v)}
            >
                <span className="text-xs">{expanded ? "▼" : "▶"}</span>
                <span className="font-medium">
                    反向链接
                </span>
                <span className="text-xs bg-gh-bg-subtle rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                    {backlinks.length}
                </span>
            </button>
            {expanded && (
                <ul className="mt-2 space-y-1 list-none pl-0">
                    {backlinks.map((b) => (
                        <li key={b.fileId}>
                            <button
                                type="button"
                                className="flex items-center gap-2 text-sm text-gh-accent hover:underline bg-transparent border-0 p-0 cursor-pointer"
                                onClick={() => handleClick(b)}
                                title={b.heading ? `在 "${b.heading}" 中引用` : undefined}
                            >
                                <svg className="size-4 shrink-0 text-gh-text-secondary" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                </svg>
                                <span>{b.fileName}</span>
                                {b.heading && (
                                    <span className="text-xs text-gh-text-secondary">({b.heading})</span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
