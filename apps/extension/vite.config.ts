import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir: "out",
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
});
