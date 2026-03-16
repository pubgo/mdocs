import { describe, it, expect } from "vitest";
import { searchInFiles, type FullTextSearchFile } from "./fullTextSearch";

const files: FullTextSearchFile[] = [
    {
        fileId: "a1",
        fileName: "README.md",
        filePath: "/docs/README.md",
        groupName: "default",
        content: "# Hello\nThis project supports graph mode.\nAnother line",
    },
    {
        fileId: "b2",
        fileName: "guide.md",
        filePath: "/docs/guide.md",
        groupName: "design",
        content: "intro\nGraph based rendering is enabled\nend",
    },
];

describe("searchInFiles", () => {
    it("returns empty for blank query", () => {
        expect(searchInFiles(files, "")).toEqual([]);
        expect(searchInFiles(files, "   ")).toEqual([]);
    });

    it("finds matches across files with line number and group", () => {
        const hits = searchInFiles(files, "graph");

        expect(hits).toHaveLength(2);
        expect(hits[0].fileId).toBe("a1");
        expect(hits[0].lineNumber).toBe(2);
        expect(hits[0].groupName).toBe("default");

        expect(hits[1].fileId).toBe("b2");
        expect(hits[1].lineNumber).toBe(2);
        expect(hits[1].groupName).toBe("design");
    });

    it("respects max results", () => {
        const hits = searchInFiles(files, "e", 1);
        expect(hits).toHaveLength(1);
    });

    it("calculates highlight range within preview", () => {
        const [hit] = searchInFiles(files, "supports");
        expect(hit).toBeDefined();
        expect(hit.matchStart).toBeGreaterThanOrEqual(0);
        expect(hit.matchEnd).toBeGreaterThan(hit.matchStart);
        expect(hit.matchEnd).toBeLessThanOrEqual(hit.preview.length);
        expect(hit.preview.slice(hit.matchStart, hit.matchEnd).toLowerCase()).toBe("supports");
    });
});
