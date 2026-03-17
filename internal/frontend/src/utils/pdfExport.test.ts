import { describe, expect, it } from "vitest";
import { toPdfFilename } from "./pdfExport";

describe("toPdfFilename", () => {
    it("returns document.pdf for empty name", () => {
        expect(toPdfFilename("")).toBe("document.pdf");
    });

    it("converts .md to .pdf", () => {
        expect(toPdfFilename("README.md")).toBe("README.pdf");
    });

    it("converts .mdx to .pdf", () => {
        expect(toPdfFilename("sample.mdx")).toBe("sample.pdf");
    });

    it("keeps .pdf unchanged", () => {
        expect(toPdfFilename("guide.pdf")).toBe("guide.pdf");
    });

    it("appends .pdf when no extension", () => {
        expect(toPdfFilename("notes")).toBe("notes.pdf");
    });
});
