import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearchModal } from "./GlobalSearchModal";
import type { Group } from "../hooks/useApi";
import { fetchFileContent } from "../hooks/useApi";

vi.mock("../hooks/useApi", async () => {
  const actual = await vi.importActual<typeof import("../hooks/useApi")>("../hooks/useApi");
  return {
    ...actual,
    fetchFileContent: vi.fn(),
  };
});

const mockedFetchFileContent = vi.mocked(fetchFileContent);

const groups: Group[] = [
  {
    name: "default",
    files: [{ id: "a1", name: "README.md", path: "/tmp/README.md" }],
  },
];

describe("GlobalSearchModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchFileContent.mockResolvedValue({
      content: "# Title\nThis graph mode is enabled",
      baseDir: "/tmp",
    });
  });

  it("passes group/file/query/line metadata when selecting a hit", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();

    render(
      <GlobalSearchModal
        isOpen
        groups={groups}
        onClose={onClose}
        onSelect={onSelect}
      />,
    );

    const input = screen.getByPlaceholderText("Search all files... (⌘/Ctrl + Shift + F)");
    await user.type(input, "graph");

    const lineLabel = await screen.findByText("Line 2");
    const button = lineLabel.closest("button");
    expect(button).not.toBeNull();

    if (!button) {
      throw new Error("Expected search result button to exist");
    }

    await user.click(button);

    expect(onSelect).toHaveBeenCalledWith({
      groupName: "default",
      fileId: "a1",
      lineNumber: 2,
      lineText: "This graph mode is enabled",
      query: "graph",
    });
    expect(onClose).toHaveBeenCalled();
  });
});