import { useCallback, useState } from "react";
import {
    useMermaidSettings,
    MERMAID_SETTINGS_DEFAULTS,
    MERMAID_PRESETS,
    bumpSettingsRevision,
    type MermaidSettings,
} from "../hooks/useMermaidSettings";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const THEME_OPTIONS: Array<{ value: MermaidSettings["theme"]; label: string }> = [
    { value: "auto", label: "Auto (跟随亮/暗主题)" },
    { value: "high-contrast", label: "高对比 (推荐)" },
    { value: "custom", label: "自定义 Mo 调色" },
    { value: "github-light", label: "GitHub Light" },
    { value: "github-dark", label: "GitHub Dark" },
    { value: "tokyo-night", label: "Tokyo Night" },
    { value: "nord", label: "Nord" },
];

interface SliderRowProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, defaultValue, onChange }: SliderRowProps) {
    return (
        <label className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm text-gh-text-secondary">{label}</span>
            <input
                type="range"
                className="flex-1 accent-gh-accent"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
            />
            <span className="w-10 text-right text-sm tabular-nums text-gh-text">
                {value}
            </span>
            {value !== defaultValue && (
                <button
                    type="button"
                    className="text-xs text-gh-text-secondary hover:text-gh-text cursor-pointer"
                    onClick={() => onChange(defaultValue)}
                    title="恢复默认"
                >
                    ↩
                </button>
            )}
        </label>
    );
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [settings, update, reset] = useMermaidSettings();
    const [dirty, setDirty] = useState(false);

    const handleUpdate = useCallback(
        (patch: Partial<MermaidSettings>) => {
            update(patch);
            setDirty(true);
        },
        [update],
    );

    const handleApply = useCallback(() => {
        bumpSettingsRevision();
        setDirty(false);
    }, []);

    const handleApplyAndClose = useCallback(() => {
        if (dirty) bumpSettingsRevision();
        setDirty(false);
        onClose();
    }, [dirty, onClose]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") handleApplyAndClose();
        },
        [handleApplyAndClose],
    );

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-gh-bg/75 p-4 md:p-8"
            onClick={handleApplyAndClose}
            onKeyDown={handleKeyDown}
            role="dialog"
            aria-modal
            aria-label="设置"
        >
            <div
                className="w-full max-w-xl mt-12 bg-gh-bg-secondary border border-gh-border rounded-xl shadow-xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gh-border">
                    <h2 className="text-base font-semibold text-gh-text">Mermaid 渲染设置</h2>
                    <button
                        type="button"
                        className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-1"
                        onClick={handleApplyAndClose}
                        aria-label="关闭"
                    >
                        <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* Presets */}
                    <div>
                        <div className="text-sm font-medium text-gh-text mb-2">快速选配</div>
                        <div className="grid grid-cols-2 gap-2">
                            {MERMAID_PRESETS.map((preset) => (
                                <button
                                    key={preset.key}
                                    type="button"
                                    className={`text-left px-3 py-2 rounded-lg border cursor-pointer transition-colors ${settings.preset === preset.key
                                            ? "border-gh-accent bg-gh-accent/10 text-gh-text"
                                            : "border-gh-border bg-gh-bg hover:bg-gh-bg-hover text-gh-text-secondary hover:text-gh-text"
                                        }`}
                                    onClick={() => handleUpdate({ ...preset.settings, preset: preset.key })}
                                >
                                    <div className="text-sm font-medium">{preset.label}</div>
                                    <div className="text-xs opacity-70">{preset.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <hr className="border-gh-border" />

                    {/* Theme selector */}
                    <label className="flex items-center gap-3">
                        <span className="w-28 shrink-0 text-sm text-gh-text-secondary">配色方案</span>
                        <select
                            className="flex-1 bg-gh-bg border border-gh-border rounded-md px-2 py-1 text-sm text-gh-text focus:border-gh-accent outline-none"
                            value={settings.theme}
                            onChange={(e) => handleUpdate({ theme: e.target.value as MermaidSettings["theme"], preset: "custom-manual" })}
                        >
                            {THEME_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <hr className="border-gh-border" />

                    {/* Layout sliders */}
                    <SliderRow
                        label="节点间距"
                        value={settings.nodeSpacing}
                        min={8}
                        max={80}
                        step={4}
                        defaultValue={MERMAID_SETTINGS_DEFAULTS.nodeSpacing}
                        onChange={(v) => handleUpdate({ nodeSpacing: v, preset: "custom-manual" })}
                    />
                    <SliderRow
                        label="层间距"
                        value={settings.layerSpacing}
                        min={16}
                        max={120}
                        step={4}
                        defaultValue={MERMAID_SETTINGS_DEFAULTS.layerSpacing}
                        onChange={(v) => handleUpdate({ layerSpacing: v, preset: "custom-manual" })}
                    />
                    <SliderRow
                        label="画布边距"
                        value={settings.padding}
                        min={0}
                        max={80}
                        step={4}
                        defaultValue={MERMAID_SETTINGS_DEFAULTS.padding}
                        onChange={(v) => handleUpdate({ padding: v, preset: "custom-manual" })}
                    />
                    <SliderRow
                        label="交叉优化"
                        value={settings.thoroughness}
                        min={1}
                        max={7}
                        step={1}
                        defaultValue={MERMAID_SETTINGS_DEFAULTS.thoroughness}
                        onChange={(v) => handleUpdate({ thoroughness: v, preset: "custom-manual" })}
                    />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-gh-border">
                    <button
                        type="button"
                        className="text-sm text-gh-text-secondary hover:text-gh-text cursor-pointer px-3 py-1.5 rounded-md hover:bg-gh-bg-hover transition-colors"
                        onClick={() => {
                            reset();
                            setDirty(true);
                        }}
                    >
                        全部重置
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className={`text-sm cursor-pointer px-4 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${dirty
                                    ? "text-white bg-green-600 hover:bg-green-700"
                                    : "text-gh-text-secondary bg-gh-bg border border-gh-border hover:bg-gh-bg-hover"
                                }`}
                            onClick={handleApply}
                        >
                            <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                            </svg>
                            {dirty ? "应用刷新" : "刷新图表"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
