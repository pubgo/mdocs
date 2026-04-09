import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import license from "rollup-plugin-license";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../static/dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Shiki themes & languages — largest payload, rarely all loaded at once
          if (id.includes("shiki/") || id.includes("@shikijs/")) {
            return "shiki";
          }
          // Mermaid + beautiful-mermaid
          if (id.includes("mermaid") && !id.includes("node_modules/d3")) {
            return "mermaid";
          }
          // D3 (used by mermaid and graph views)
          if (id.includes("node_modules/d3")) {
            return "d3";
          }
          // KaTeX
          if (id.includes("katex")) {
            return "katex";
          }
          // AntV G6 (graph views)
          if (id.includes("@antv/")) {
            return "antv";
          }
          // PDF export
          if (id.includes("jspdf") || id.includes("html-to-image")) {
            return "pdf";
          }
          // React core
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "react";
          }
        },
      },
      plugins: [
        license({
          thirdParty: {
            output: {
              file: path.resolve(__dirname, "CREDITS_FRONTEND"),
              template(dependencies) {
                return dependencies
                  .map(
                    (dep) => {
                      const repo = typeof dep.repository === "string"
                        ? dep.repository
                        : dep.repository?.url || "";
                      const url = repo || dep.homepage || "";
                      return `${dep.name}\n${url}\n----------------------------------------------------------------\n${dep.licenseText || `License: ${dep.license}`}\n`;
                    },
                  )
                  .join(
                    "\n================================================================\n\n",
                  );
              },
            },
          },
        }),
      ],
    },
  },
  server: {
    proxy: {
      "/_/": "http://localhost:6275",
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/utils/**", "src/hooks/**", "src/components/**"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
