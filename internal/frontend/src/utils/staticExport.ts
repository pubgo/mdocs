/**
 * Static site export: triggers the server-side export endpoint
 * which returns a zip file containing rendered HTML files + CSS.
 */
export async function downloadStaticSite(groupName: string): Promise<void> {
    const params = new URLSearchParams({ group: groupName });
    const res = await fetch(`/_/api/export/static?${params}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Export failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${groupName}-static-site.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
