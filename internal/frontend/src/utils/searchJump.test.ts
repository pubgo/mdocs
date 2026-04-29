import { describe, it, expect } from "vitest";
import { findBestSearchTarget } from "./searchJump";

describe("findBestSearchTarget", () => {
  it("prefers a line-text match when available", () => {
    const root = document.createElement("article");
    root.innerHTML = `
      <p id="line-1">Alpha text</p>
      <p id="line-2">Target line: Graph mode enabled</p>
      <p id="line-3">Other line</p>
    `;

    const target = findBestSearchTarget(root, "Target line: Graph mode enabled", "graph");
    expect(target?.id).toBe("line-2");
  });

  it("falls back to query match when line text is not found", () => {
    const root = document.createElement("article");
    root.innerHTML = `
      <h2 id="heading">Graph Overview</h2>
      <p id="body">No exact copied line here.</p>
    `;

    const target = findBestSearchTarget(root, "Nonexistent line content", "graph");
    expect(target?.id).toBe("heading");
  });

  it("returns null when neither line nor query can be matched", () => {
    const root = document.createElement("article");
    root.innerHTML = `<p id="only">Hello world</p>`;

    const target = findBestSearchTarget(root, "Another line", "missing keyword");
    expect(target).toBeNull();
  });
});