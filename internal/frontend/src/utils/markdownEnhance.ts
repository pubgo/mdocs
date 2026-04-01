const ADMONITION_TYPE_MAP: Record<string, string> = {
    note: "NOTE",
    info: "NOTE",
    tip: "TIP",
    important: "IMPORTANT",
    warning: "WARNING",
    caution: "CAUTION",
    danger: "CAUTION",
};

function normalizeWikiTarget(rawTarget: string): string {
    const target = rawTarget.trim();
    if (!target) return target;
    if (/^(https?:\/\/|mailto:|tel:|#)/i.test(target)) return target;

    const hashIndex = target.indexOf("#");
    const base = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
    const hash = hashIndex >= 0 ? target.slice(hashIndex) : "";

    if (!base) return target;
    if (/\.mdx?$/i.test(base)) return `${base}${hash}`;
    return `${base}.md${hash}`;
}

function looksLikePathPart(text: string): boolean {
    return /[\/.#]/.test(text.trim());
}

function parseWikiLinkBody(body: string): { target: string; label: string } {
    const trimmed = body.trim();
    if (!trimmed.includes("|")) {
        return { target: normalizeWikiTarget(trimmed), label: trimmed };
    }

    const [leftRaw, ...rest] = trimmed.split("|");
    const rightRaw = rest.join("|");
    const left = leftRaw.trim();
    const right = rightRaw.trim();

    // Support both [[link|text]] (wiki-style) and [[text|link]] (GitHub-style-like)
    if (looksLikePathPart(left) && !looksLikePathPart(right)) {
        return { target: normalizeWikiTarget(left), label: right || left };
    }
    if (looksLikePathPart(right) && !looksLikePathPart(left)) {
        return { target: normalizeWikiTarget(right), label: left || right };
    }

    return { target: normalizeWikiTarget(left), label: right || left };
}

export function transformWikiLinks(markdown: string): string {
    return markdown.replace(/\[\[([^\]]+)\]\]/g, (_whole, inner: string) => {
        const { target, label } = parseWikiLinkBody(inner);
        if (!target) return _whole;
        return `[${label}](${target})`;
    });
}

export function transformAdmonitions(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    const out: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const match = line.match(/^!!!\s+([a-zA-Z][\w-]*)(?:\s+(.*))?$/);

        if (!match) {
            out.push(line);
            continue;
        }

        const typeRaw = match[1].toLowerCase();
        const title = (match[2] || "").trim();
        const alertType = ADMONITION_TYPE_MAP[typeRaw] || "NOTE";

        out.push(`> [!${alertType}]${title ? ` ${title}` : ""}`);

        let j = i + 1;
        while (j < lines.length) {
            const bodyLine = lines[j];
            if (bodyLine.startsWith("    ")) {
                out.push(`> ${bodyLine.slice(4)}`);
                j += 1;
                continue;
            }
            if (bodyLine.startsWith("\t")) {
                out.push(`> ${bodyLine.slice(1)}`);
                j += 1;
                continue;
            }
            if (bodyLine.trim() === "") {
                out.push("> ");
                j += 1;
                continue;
            }
            break;
        }

        i = j - 1;
    }

    return out.join("\n");
}

export function transformMarkdownForMo(markdown: string): string {
    return transformWikiLinks(transformAdmonitions(markdown));
}
