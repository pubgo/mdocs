import { useCallback } from "react";
import { useMermaidSettings, MERMAID_SETTINGS_DEFAULTS, type MermaidSettings } from "../hooks/useMermaidSettings";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const THEME_OPTIONS: Array<{ value: MermaidSettings["theme"]; label: string }> = [
    { value: "custom", label: "自定义 (跟随 mo 主题)" },
    { value: "auto", label: "Auto (github-light / github-dark)" },
    { value: "github-light", label: "GitHub Light" },
    { value: "github-dark", label: "GitHub Dark" },
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
            <span className="w-32 shrink-0 text-sm text-gh-text-secondary">{label}</span>
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

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        },
        [onClose],
    );

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-gh-bg/75 p-4 md:p-8"
            onClick={onClose}
            onKeyDown={handleKeyDown}
            role="dialog"
            aria-modal
            aria-label="设置"
        >
            <div
                className="w-full max-w-lg mt-16 bg-gh-bg-secondary border border-gh-border rounded-xl shadow-xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gh-border">
                    <h2 className="text-base font-semibold text-gh-text">Mermaid 渲染设置</h2>
                    <button
                        type="button"
                        className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-1"
                        onClick={onClose}
                        aria-label="关闭"
                    >
                        <svg className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4">
                    {/* Theme selector */}
                    <label className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-sm text-gh-text-secondary">配色方案</span>
                        <select
                            className="flex-1 bg-gh-bg border border-gh-border rounded-md px-2 py-1 text-sm text-gh-text focus:border-gh-accent outline-none"
                            value={settings.theme}
                            onChange={(e) => update({ theme: e.target.value as MermaidSettings["theme"] })}
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
                        onChange={(v) => update({ nodeSpacing: v })}
                    />
                    <SliderRow
                        label="层间距"
                        value={settings.layerSpacing}
                        min={16}
                        max={120}
                        step={4}
                        defaultValue={MERMAID_SETTINGS_DEFAULTS.layerSpacing}
                        onChange={(v) => update({ layerSpacing: v })}
                    />
                    <SliderRow
                        label="画布边距"
                        value={settings.padding}
                        min={0}
                        max={80}
                        step={4}
                        defaultValue={MERMAID_SETTINGS_DEFAULTS.padding}
                        onChange={(v) => update({ padding: v })}
                    />
                    <SliderRow
                        label="交叉优化"
                        value={settings.thoroughness}
                        min={1}
                        max={7}
                        step={1}
                        defaultValue={MERMAID_SETTINGS_DEFAULTS.thoroughness}
                        onChange={(v) => update({ thoroughness: v })}
                    />

                    <p className="text-xs text-gh-text-secondary">
                        交叉优化值越大，线条越整齐，但渲染速度越慢。修改后需刷新页面或重新切换文件生效。
                    </p>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gh-border">
                    <button
                        type="button"
                        className="text-sm text-gh-text-secondary hover:text-gh-text cursor-pointer px-3 py-1.5 rounded-md hover:bg-gh-bg-hover transition-colors"
                        onClick={reset}
                    >
                        全部重置
                    </button>
                    <button
                        type="button"
                        className="text-sm text-gh-header-text bg-gh-accent hover:bg-gh-accent/90 cursor-pointer px-3 py-1.5 rounded-md transition-colors"
                        onClick={onClose}
                    >
                        完成
                    </button>
                </div>
            </div>
        </div>
    );
}
