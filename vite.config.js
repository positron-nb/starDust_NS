import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  publicDir: "../public",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  server: { port: 5173 },
});
