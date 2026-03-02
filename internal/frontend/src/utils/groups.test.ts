import { describe, it, expect } from "vitest";
import {
  allFileIds,
  parseGroupFromPath,
  groupToPath,
  buildFileUrl,
  parseFileIdFromSearch,
} from "./groups";
import type { Group } from "../hooks/useApi";

describe("allFileIds", () => {
  it("returns empty set for no groups", () => {
    expect(allFileIds([])).toEqual(new Set());
  });

  it("collects IDs from a single group", () => {
    const groups: Group[] = [
      {
        name: "default",
        files: [
          { id: 1, name: "a.md", path: "/a.md" },
          { id: 2, name: "b.md", path: "/b.md" },
        ],
      },
    ];
    expect(allFileIds(groups)).toEqual(new Set([1, 2]));
  });

  it("collects IDs from multiple groups", () => {
    const groups: Group[] = [
      {
        name: "default",
        files: [{ id: 1, name: "a.md", path: "/a.md" }],
      },
      {
        name: "docs",
        files: [
          { id: 2, name: "b.md", path: "/b.md" },
          { id: 3, name: "c.md", path: "/c.md" },
        ],
      },
    ];
    expect(allFileIds(groups)).toEqual(new Set([1, 2, 3]));
  });

  it("handles groups with no files", () => {
    const groups: Group[] = [
      { name: "empty", files: [] },
      {
        name: "notempty",
        files: [{ id: 5, name: "e.md", path: "/e.md" }],
      },
    ];
    expect(allFileIds(groups)).toEqual(new Set([5]));
  });
});

describe("parseGroupFromPath", () => {
  it("returns 'default' for root path", () => {
    expect(parseGroupFromPath("/")).toBe("default");
  });

  it("returns 'default' for empty string", () => {
    expect(parseGroupFromPath("")).toBe("default");
  });

  it("extracts group name from path", () => {
    expect(parseGroupFromPath("/design")).toBe("design");
  });

  it("strips trailing slash", () => {
    expect(parseGroupFromPath("/docs/")).toBe("docs");
  });

  it("handles path without leading slash", () => {
    expect(parseGroupFromPath("notes")).toBe("notes");
  });
});

describe("groupToPath", () => {
  it("returns / for default group", () => {
    expect(groupToPath("default")).toBe("/");
  });

  it("returns /name for named group", () => {
    expect(groupToPath("design")).toBe("/design");
  });
});

describe("buildFileUrl", () => {
  it("builds URL for default group", () => {
    expect(buildFileUrl("default", 1)).toBe("/?file=1");
  });

  it("builds URL for named group", () => {
    expect(buildFileUrl("design", 5)).toBe("/design?file=5");
  });
});

describe("parseFileIdFromSearch", () => {
  it("returns null for empty search", () => {
    expect(parseFileIdFromSearch("")).toBeNull();
  });

  it("parses file id from search string", () => {
    expect(parseFileIdFromSearch("?file=2")).toBe(2);
  });

  it("returns null for non-numeric value", () => {
    expect(parseFileIdFromSearch("?file=abc")).toBeNull();
  });

  it("returns null when file param is missing", () => {
    expect(parseFileIdFromSearch("?other=1")).toBeNull();
  });

  it("handles search with multiple params", () => {
    expect(parseFileIdFromSearch("?foo=bar&file=10&baz=1")).toBe(10);
  });

  it("returns null for zero", () => {
    expect(parseFileIdFromSearch("?file=0")).toBeNull();
  });

  it("returns null for negative value", () => {
    expect(parseFileIdFromSearch("?file=-3")).toBeNull();
  });
});
