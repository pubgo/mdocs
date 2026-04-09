import { useState } from "react";
import { downloadStaticSite } from "../utils/staticExport";

interface StaticExportButtonProps {
    groupName: string;
}

export function StaticExportButton({ groupName }: StaticExportButtonProps) {
    const [exporting, setExporting] = useState(false);

    const handleExport = async () => {
        if (exporting) return;
        setExporting(true);
        try {
            await downloadStaticSite(groupName);
        } catch (err) {
            console.error("Static export failed:", err);
        } finally {
            setExporting(false);
        }
    };

    return (
        <button
            type="button"
            className="flex items-center justify-center bg-transparent border border-gh-border rounded-md p-1.5 text-gh-text-secondary cursor-pointer transition-colors duration-150 hover:bg-gh-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleExport}
            disabled={exporting}
            title="导出静态站点 (ZIP)"
            aria-label="Export static site"
        >
            {exporting ? (
                <svg className="size-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
            ) : (
                <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                </svg>
            )}
        </button>
    );
}
