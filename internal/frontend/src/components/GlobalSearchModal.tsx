import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "../hooks/useApi";
import { fetchFileContent } from "../hooks/useApi";
import {
    searchInFiles,
    type FullTextSearchFile,
    type FullTextSearchHit,
} from "../utils/fullTextSearch";

interface GlobalSearchModalProps {
    isOpen: boolean;
    groups: Group[];
    onClose: () => void;
    onSelect: (selection: GlobalSearchSelection) => void;
}

export interface GlobalSearchSelection {
    groupName: string;
    fileId: string;
    lineNumber: number;
    lineText: string;
    query: string;
}

function HighlightedPreview({ hit }: { hit: FullTextSearchHit }) {
    const before = hit.preview.slice(0, hit.matchStart);
    const target = hit.preview.slice(hit.matchStart, hit.matchEnd);
    const after = hit.preview.slice(hit.matchEnd);

    return (
        <p className="mt-1 text-xs text-gh-text-secondary break-all">
            {before}
            <mark className="bg-yellow-300/70 text-gh-text rounded-sm px-0.5">{target}</mark>
            {after}
        </p>
    );
}

export function GlobalSearchModal({ isOpen, groups, onClose, onSelect }: GlobalSearchModalProps) {
    const [query, setQuery] = useState("");
    const [indexedFiles, setIndexedFiles] = useState<FullTextSearchFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const contentCache = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        if (!isOpen) return;
        setQuery("");
        inputRef.current?.focus();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        const descriptors = groups.flatMap((group) =>
            group.files.map((file) => ({
                fileId: file.id,
                fileName: file.name,
                filePath: file.path,
                groupName: group.name,
            })),
        );

        if (descriptors.length === 0) {
            setIndexedFiles([]);
            setLoading(false);
            setLoadError(null);
            return;
        }

        setLoading(true);
        setLoadError(null);

        void (async () => {
            const loaded = await Promise.all(
                descriptors.map(async (d) => {
                    const cached = contentCache.current.get(d.fileId);
                    if (cached != null) {
                        return {
                            ok: true as const,
                            file: { ...d, content: cached },
                        };
                    }

                    try {
                        const res = await fetchFileContent(d.fileId);
                        contentCache.current.set(d.fileId, res.content);
                        return {
                            ok: true as const,
                            file: { ...d, content: res.content },
                        };
                    } catch {
                        return {
                            ok: false as const,
                            file: null,
                        };
                    }
                }),
            );

            if (cancelled) return;

            const files = loaded.flatMap((item) => (item.ok && item.file ? [item.file] : []));
            const failedCount = loaded.length - files.length;

            setIndexedFiles(files);
            setLoading(false);
            if (failedCount > 0) {
                setLoadError(`有 ${failedCount} 个文件内容读取失败`);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [groups, isOpen]);

    const hits = useMemo(() => searchInFiles(indexedFiles, query), [indexedFiles, query]);

    const handleSelect = useCallback(
        (hit: FullTextSearchHit) => {
            const normalizedQuery = query.trim();
            onSelect({
                groupName: hit.groupName,
                fileId: hit.fileId,
                lineNumber: hit.lineNumber,
                lineText: hit.lineText,
                query: normalizedQuery,
            });
            onClose();
        },
        [onClose, onSelect, query],
    );

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-gh-bg/75 p-4 md:p-8"
            onClick={onClose}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    onClose();
                }
            }}
        >
            <div
                className="w-full max-w-4xl bg-gh-bg-secondary border border-gh-border rounded-xl shadow-xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-3 border-b border-gh-border">
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && hits[0]) {
                                e.preventDefault();
                                handleSelect(hits[0]);
                            }
                        }}
                        placeholder="Search all files... (⌘/Ctrl + Shift + F)"
                        className="w-full px-3 py-2 text-sm bg-gh-bg border border-gh-border rounded-md text-gh-text placeholder:text-gh-text-secondary outline-none focus:border-gh-accent"
                    />
                </div>

                <div className="max-h-[70vh] overflow-y-auto p-2">
                    {loading && <p className="px-2 py-3 text-sm text-gh-text-secondary">正在索引文件内容…</p>}

                    {!loading && query.trim() === "" && (
                        <p className="px-2 py-3 text-sm text-gh-text-secondary">输入关键词后将全局搜索所有文件内容</p>
                    )}

                    {!loading && query.trim() !== "" && hits.length === 0 && (
                        <p className="px-2 py-3 text-sm text-gh-text-secondary">没有匹配结果</p>
                    )}

                    {!loading &&
                        hits.map((hit) => (
                            <button
                                key={hit.id}
                                type="button"
                                className="w-full text-left px-2 py-2 rounded-md hover:bg-gh-bg-hover transition-colors"
                                onClick={() => handleSelect(hit)}
                                title={`${hit.filePath || hit.fileName}:${hit.lineNumber}`}
                            >
                                <p className="text-sm text-gh-text font-medium">
                                    {hit.fileName}
                                    <span className="ml-2 text-xs text-gh-text-secondary">[{hit.groupName}]</span>
                                    <span className="ml-2 text-xs text-gh-text-secondary">Line {hit.lineNumber}</span>
                                </p>
                                <HighlightedPreview hit={hit} />
                            </button>
                        ))}

                    {loadError && <p className="px-2 py-2 text-xs text-red-500">{loadError}</p>}
                </div>
            </div>
        </div>
    );
}
