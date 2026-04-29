import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MermaidBlock } from "./MarkdownViewer";

const renderMermaidSVGMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

vi.mock("beautiful-mermaid", () => ({
  renderMermaidSVG: renderMermaidSVGMock,
}));

import mermaid from "mermaid";

const writeTextMock = vi.fn().mockResolvedValue(undefined);
const writeMock = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  renderMermaidSVGMock.mockImplementation(() => {
    throw new Error("beautiful-mermaid disabled in baseline tests");
  });
  writeTextMock.mockClear();
  writeMock.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeTextMock, write: writeMock },
    writable: true,
    configurable: true,
  });
});

describe("MermaidBlock", () => {
  it("uses beautiful-mermaid renderer when available for supported diagrams", async () => {
    renderMermaidSVGMock.mockReturnValue('<svg width="360" height="180">diagram</svg>');

    render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Copy code")).toBeInTheDocument();
    });

    const beautifulCalls = renderMermaidSVGMock.mock.calls.length;
    const mermaidCalls = vi.mocked(mermaid.render).mock.calls.length;
    expect(beautifulCalls + mermaidCalls).toBeGreaterThan(0);
    if (beautifulCalls > 0) {
      expect(mermaidCalls).toBe(0);
    }
  });

  it("falls back to mermaid renderer when beautiful-mermaid fails", async () => {
    renderMermaidSVGMock.mockImplementation(() => {
      throw new Error("beautiful render failed");
    });
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: "<svg>fallback</svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Copy code")).toBeInTheDocument();
    });

    expect(renderMermaidSVGMock).toHaveBeenCalled();
    expect(vi.mocked(mermaid.render)).toHaveBeenCalled();
  });

  it("shows copy button when mermaid renders successfully", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: "<svg>diagram</svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Copy code")).toBeInTheDocument();
    });
  });

  it("shows copy button in fallback mode when rendering fails", async () => {
    vi.mocked(mermaid.render).mockRejectedValue(new Error("parse error"));

    render(<MermaidBlock code="invalid mermaid" />);

    await waitFor(() => {
      expect(screen.getByTitle("Copy code")).toBeInTheDocument();
    });
    expect(screen.getByText("invalid mermaid")).toBeInTheDocument();
  });

  it("copies original mermaid code to clipboard on click", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: "<svg>diagram</svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Copy code")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Copy code"));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("graph TD; A-->B");
    });
  });

  it("shows image copy button when mermaid renders successfully", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: "<svg>diagram</svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Copy image")).toBeInTheDocument();
    });
    expect(screen.getByTitle("Fullscreen")).toBeInTheDocument();

    const block = document.querySelector(".mermaid-block");
    expect(block?.className).toContain("mermaid-block--constrain-height");
  });

  it("fits small diagram svg to container width while respecting max height", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg width="240" height="200"><g><text>diagram</text></g></svg>',
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    const { container } = render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      const width = parseFloat(svg?.getAttribute("width") || "0");
      const height = parseFloat(svg?.getAttribute("height") || "0");
      expect(width).toBeGreaterThan(240);
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThanOrEqual(960);
      expect(svg?.getAttribute("viewBox")).toBe("0 0 240 200");
      expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
      expect(svg?.getAttribute("style") || "").toContain("max-width:100%");
    });
  });

  it("does not show image copy button when rendering fails", async () => {
    vi.mocked(mermaid.render).mockRejectedValue(new Error("parse error"));

    render(<MermaidBlock code="invalid mermaid" />);

    await waitFor(() => {
      expect(screen.getByTitle("Copy code")).toBeInTheDocument();
    });
    expect(screen.queryByTitle("Copy image")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Fullscreen")).not.toBeInTheDocument();
  });

  it("calls requestFullscreen on fullscreen button click", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: "<svg>diagram</svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: requestFullscreenMock,
      configurable: true,
      writable: true,
    });

    render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Fullscreen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Fullscreen"));

    await waitFor(() => {
      expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    });

    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: originalRequestFullscreen,
      configurable: true,
      writable: true,
    });
  });

  it("supports zoom and pan interactions in fullscreen", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: "<svg>diagram</svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    let fullscreenElement: Element | null = null;
    const originalFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
    Object.defineProperty(document, "fullscreenElement", {
      get: () => fullscreenElement,
      configurable: true,
    });

    const requestFullscreenMock = vi.fn().mockImplementation(function (this: HTMLElement) {
      fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: requestFullscreenMock,
      configurable: true,
      writable: true,
    });

    render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Fullscreen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Fullscreen"));

    await waitFor(() => {
      expect(screen.getByTitle("Zoom in")).toBeInTheDocument();
    });

    const zoomLevel = screen.getByTitle("Zoom level");
    expect(zoomLevel).toHaveTextContent("100%");

    fireEvent.click(screen.getByTitle("Zoom in"));
    await waitFor(() => {
      expect(zoomLevel).toHaveTextContent("110%");
    });

    fireEvent.click(screen.getByTitle("Zoom out"));
    await waitFor(() => {
      expect(zoomLevel).toHaveTextContent("100%");
    });

    for (let i = 0; i < 120; i += 1) {
      fireEvent.click(screen.getByTitle("Zoom in"));
    }
    await waitFor(() => {
      expect(zoomLevel).toHaveTextContent("1000%");
    });

    const surface = screen.getByTestId("mermaid-interaction-surface");
    const canvas = screen.getByTestId("mermaid-pan-canvas");

    fireEvent.mouseDown(surface, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 140, clientY: 125 });
    fireEvent.mouseUp(surface);

    await waitFor(() => {
      expect(canvas.getAttribute("style") || "").toContain("translate(40px, 25px)");
    });

    fireEvent.click(screen.getByTitle("Reset view"));
    await waitFor(() => {
      expect(zoomLevel).toHaveTextContent("100%");
      expect(canvas.getAttribute("style") || "").toContain("translate(0px, 0px)");
    });

    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: originalRequestFullscreen,
      configurable: true,
      writable: true,
    });

    if (originalFullscreenDescriptor) {
      Object.defineProperty(document, "fullscreenElement", originalFullscreenDescriptor);
    } else {
      delete (document as { fullscreenElement?: Element | null }).fullscreenElement;
    }
  });

  it("uses larger default fullscreen zoom for complex mermaid diagrams", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: "<svg>diagram</svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    let fullscreenElement: Element | null = null;
    const originalFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
    Object.defineProperty(document, "fullscreenElement", {
      get: () => fullscreenElement,
      configurable: true,
    });

    const requestFullscreenMock = vi.fn().mockImplementation(function (this: HTMLElement) {
      fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: requestFullscreenMock,
      configurable: true,
      writable: true,
    });

    const complexCode = [
      "graph TD",
      ...Array.from({ length: 80 }, (_, i) => `N${i}[Node ${i}] --> N${i + 1}[Node ${i + 1}]`),
    ].join("\n");

    render(<MermaidBlock code={complexCode} />);

    await waitFor(() => {
      expect(screen.getByTitle("Fullscreen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Fullscreen"));

    await waitFor(() => {
      expect(screen.getByTitle("Zoom level")).toHaveTextContent("200%");
    });

    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: originalRequestFullscreen,
      configurable: true,
      writable: true,
    });

    if (originalFullscreenDescriptor) {
      Object.defineProperty(document, "fullscreenElement", originalFullscreenDescriptor);
    } else {
      delete (document as { fullscreenElement?: Element | null }).fullscreenElement;
    }
  });

  it("converts escaped newline markers in labels to html line breaks before render", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: "<svg>diagram</svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    render(<MermaidBlock code={'graph LR; A["hello\\nworld"] --> B'} />);

    await waitFor(() => {
      expect(mermaid.render).toHaveBeenCalled();
      const calls = vi.mocked(mermaid.render).mock.calls;
      const renderedCode = calls[0]?.[1];
      expect(renderedCode).toContain("hello<br/>world");
      expect(renderedCode).not.toContain("hello\\nworld");
    });
  });

  it("fits very wide mermaid diagrams within markdown width", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg width="240" height="120">diagram</svg>',
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    const complexCode = [
      "graph TD",
      ...Array.from({ length: 80 }, (_, i) => `N${i}[Node ${i}] --> N${i + 1}[Node ${i + 1}]`),
    ].join("\n");

    render(<MermaidBlock code={complexCode} />);

    await waitFor(() => {
      const canvas = screen.getByTestId("mermaid-pan-canvas");
      const style = canvas.getAttribute("style") || "";
      expect(style).toContain("width: 100%");
      expect(style).toContain("max-width: 100%");

      const svg = canvas.querySelector("svg");
      const width = parseFloat(svg?.getAttribute("width") || "0");
      expect(width).toBeGreaterThan(500);
      expect(svg?.getAttribute("style") || "").toContain("max-width:100%");
    });
  });

  it("constrains height for very tall mermaid diagrams", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg width="260" height="900">diagram</svg>',
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    const { container } = render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      const block = container.querySelector(".mermaid-block");
      expect(block?.className).toContain("mermaid-block--constrain-height");

      const canvas = screen.getByTestId("mermaid-pan-canvas");
      const style = canvas.getAttribute("style") || "";
      expect(style).toContain("width: 100%");
      expect(style).toContain("max-width: 100%");

      const svg = canvas.querySelector("svg");
      const height = parseFloat(svg?.getAttribute("height") || "0");
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThanOrEqual(960);
    });
  });

  it("keeps wide viewBox-only svg within markdown width", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg viewBox="0 0 2200 420">diagram</svg>',
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    render(<MermaidBlock code="graph LR; A-->B" />);

    await waitFor(() => {
      const canvas = screen.getByTestId("mermaid-pan-canvas");
      const svg = canvas.querySelector("svg");
      const width = parseFloat(svg?.getAttribute("width") || "0");
      const height = parseFloat(svg?.getAttribute("height") || "0");
      expect(width).toBeGreaterThan(500);
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThanOrEqual(960);
      expect(svg?.getAttribute("style") || "").toContain("max-width:100%");
    });
  });

  it("scales extremely large LR-like svg within width and viewport-safe height", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg width="6200" height="2400" viewBox="0 0 6200 2400">diagram</svg>',
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    render(
      <MermaidBlock
        code={[
          "graph LR",
          "A --> B --> C --> D --> E --> F --> G --> H --> I --> J",
          "A --> K --> L --> M --> N --> O --> P --> Q --> R --> S",
        ].join("\n")}
      />,
    );

    await waitFor(() => {
      const canvas = screen.getByTestId("mermaid-pan-canvas");
      const svg = canvas.querySelector("svg");

      const width = parseFloat(svg?.getAttribute("width") || "0");
      const height = parseFloat(svg?.getAttribute("height") || "0");
      const style = svg?.getAttribute("style") || "";

      expect(width).toBeGreaterThan(700);
      expect(width).toBeLessThanOrEqual(820);
      expect(height).toBeGreaterThan(250);
      expect(height).toBeLessThanOrEqual(960);
      expect(style).toContain("max-width:100%");
      expect(style).toContain("width:");
      expect(style).toContain("height:");
    });
  });

  it("calls navigator.clipboard.write on image copy button click", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">diagram</svg>',
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    // Mock URL.createObjectURL / revokeObjectURL (not available in jsdom)
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();

    // Mock ClipboardItem (not available in jsdom)
    const originalClipboardItem = globalThis.ClipboardItem;
    vi.stubGlobal(
      "ClipboardItem",
      class MockClipboardItem {
        types: string[];
        items: Record<string, Blob>;
        constructor(items: Record<string, Blob>) {
          this.items = items;
          this.types = Object.keys(items);
        }
        getType(type: string) {
          return Promise.resolve(this.items[type]);
        }
      },
    );

    // Mock Image to trigger onload
    const originalImage = globalThis.Image;
    vi.stubGlobal(
      "Image",
      class MockImage {
        naturalWidth = 100;
        naturalHeight = 100;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        _src = "";
        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          setTimeout(() => this.onload?.(), 0);
        }
      },
    );

    // Mock canvas via createElement
    const mockBlob = new Blob(["png"], { type: "image/png" });
    const mockCtx = { drawImage: vi.fn(), scale: vi.fn() };
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => mockCtx,
            toBlob: (cb: (b: Blob | null) => void) => cb(mockBlob),
          } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tag, options);
      },
    );

    render(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTitle("Copy image")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Copy image"));

    await waitFor(() => {
      expect(writeMock).toHaveBeenCalledTimes(1);
    });

    globalThis.Image = originalImage;
    globalThis.ClipboardItem = originalClipboardItem;
    vi.mocked(document.createElement).mockRestore();
  });
});
