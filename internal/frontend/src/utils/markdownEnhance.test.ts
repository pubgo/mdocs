import { describe, it, expect } from "vitest";
import { transformAdmonitions, transformWikiLinks, transformMarkdownForMo } from "./markdownEnhance";

describe("transformAdmonitions", () => {
    it("converts basic admonition blocks to GitHub alert blockquote", () => {
        const input = [
            "!!! warning Be careful",
            "    Keep backup before migration.",
            "",
            "Next paragraph",
        ].join("\n");

        const output = transformAdmonitions(input);
        expect(output).toContain("> [!WARNING] Be careful");
        expect(output).toContain("> Keep backup before migration.");
        expect(output).toContain("Next paragraph");
    });

    it("supports admonition without title", () => {
        const input = [
            "!!! note",
            "    body line",
        ].join("\n");

        expect(transformAdmonitions(input)).toBe(["> [!NOTE]", "> body line"].join("\n"));
    });
});

describe("transformWikiLinks", () => {
    it("converts simple wiki links to markdown links with .md", () => {
        expect(transformWikiLinks("See [[Getting Started]]")).toBe(
            "See [Getting Started](Getting Started.md)",
        );
    });

    it("keeps .md/.mdx extension if already present", () => {
        expect(transformWikiLinks("[[docs/intro.md]] and [[comp.mdx]]")).toBe(
            "[docs/intro.md](docs/intro.md) and [comp.mdx](comp.mdx)",
        );
    });

    it("supports wiki-style piped links [[link|text]]", () => {
        expect(transformWikiLinks("[[docs/setup|Setup Guide]]")).toBe(
            "[Setup Guide](docs/setup.md)",
        );
    });

    it("supports text-first piped links [[text|link]] when right side looks like path", () => {
        expect(transformWikiLinks("[[Setup Guide|docs/setup]]")).toBe(
            "[Setup Guide](docs/setup.md)",
        );
    });

    it("preserves hash and appends .md when needed", () => {
        expect(transformWikiLinks("[[guide#install]]")).toBe("[guide#install](guide.md#install)");
    });
});

describe("transformMarkdownForMo", () => {
    it("applies both admonition and wiki transforms", () => {
        const input = [
            "!!! tip Quick Start",
            "    Read [[docs/setup|Setup Guide]] first.",
        ].join("\n");

        const output = transformMarkdownForMo(input);
        expect(output).toContain("> [!TIP] Quick Start");
        expect(output).toContain("[Setup Guide](docs/setup.md)");
    });
});
