import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SvgBobBlock } from "./MarkdownViewer";

const renderSvgBob = vi.fn();
const loadWASM = vi.fn().mockResolvedValue(undefined);

vi.mock("bob-wasm", () => ({
    default: {
        loadWASM,
        render: renderSvgBob,
    },
}));

describe("SvgBobBlock", () => {
    const createObjectURL = vi.fn(() => "blob:svgbob-diagram");
    const revokeObjectURL = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        loadWASM.mockResolvedValue(undefined);
        Object.defineProperty(URL, "createObjectURL", {
            value: createObjectURL,
            writable: true,
            configurable: true,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            value: revokeObjectURL,
            writable: true,
            configurable: true,
        });
    });

    it("renders svg when svgbob conversion succeeds", async () => {
        vi.mocked(renderSvgBob).mockReturnValue('<svg viewBox="0 0 100 40"><text>ok</text></svg>');

        render(
            <SvgBobBlock
                code={[
                    "+------+",
                    "| app  |",
                    "+------+",
                ].join("\n")}
            />,
        );

        await waitFor(() => {
            const img = screen.getByRole("img", { name: "SVG Bob diagram" }) as HTMLImageElement;
            expect(img).toBeTruthy();
            expect(img.src).toContain("blob:svgbob-diagram");
            expect(createObjectURL).toHaveBeenCalledTimes(1);
            expect(screen.getByTitle("Copy code")).toBeInTheDocument();
        });
    });

    it("falls back to preformatted code when svgbob conversion fails", async () => {
        vi.mocked(renderSvgBob).mockImplementation(() => {
            throw new Error("svgbob parse error");
        });

        render(<SvgBobBlock code={"+---+"} />);

        await waitFor(() => {
            expect(screen.getByText("+---+")).toBeInTheDocument();
            expect(screen.queryByRole("img", { name: "SVG Bob diagram" })).not.toBeInTheDocument();
            expect(screen.getByTitle("Copy code")).toBeInTheDocument();
        });
    });
});
