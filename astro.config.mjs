import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  build: {
    assets: "assets",
    inlineStylesheets: "never"
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    }
  }
});
