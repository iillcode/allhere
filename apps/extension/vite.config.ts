import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir: "out",
    emptyOutDir: true,
    license: { fileName: "third-party-licenses.md" },
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        panel: fileURLToPath(new URL("./index.html", import.meta.url)),
        media: fileURLToPath(new URL("./media.html", import.meta.url)),
        "capture-worker": fileURLToPath(new URL("./src/captureWorker.ts", import.meta.url)),
      },
      output: { entryFileNames: chunk => chunk.name === "capture-worker" ? "capture-worker.js" : "assets/[name]-[hash].js" },
    },
  },
});
