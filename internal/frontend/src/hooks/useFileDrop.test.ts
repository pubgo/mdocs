import { describe, it, expect } from "vitest";
import { isMarkdown } from "./useFileDrop";

describe("isMarkdown", () => {
  it("accepts .md files", () => {
    expect(isMarkdown("readme.md")).toBe(true);
  });

  it("accepts .markdown files", () => {
    expect(isMarkdown("doc.markdown")).toBe(true);
  });

  it("accepts .mdx files", () => {
    expect(isMarkdown("page.mdx")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isMarkdown("README.MD")).toBe(true);
    expect(isMarkdown("Doc.Markdown")).toBe(true);
    expect(isMarkdown("Page.MDX")).toBe(true);
  });

  it("rejects non-markdown files", () => {
    expect(isMarkdown("script.js")).toBe(false);
    expect(isMarkdown("style.css")).toBe(false);
    expect(isMarkdown("image.png")).toBe(false);
    expect(isMarkdown("data.json")).toBe(false);
  });
});
