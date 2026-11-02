import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  worker: { format: "es" },
  build: {
    target: "es2023",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "sound-lab": fileURLToPath(new URL("./sound-lab.html", import.meta.url)),
        paperLab: fileURLToPath(new URL("./paper-lab.html", import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three") || id.includes("@react-three") || id.includes("postprocessing")) return "three";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:8787", ws: true, changeOrigin: true } },
  },
  test: {
    environment: "jsdom",
    // Generous: WASM games and SVG tracing run long on loaded CI runners.
    testTimeout: 60_000,
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
  },
});
