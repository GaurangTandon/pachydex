// For building the huggingface files so they can be loaded from a local file on the filesystem
// as Chrome extension service worker cannot directly import from a module file

import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "src/sandbox/built",

    lib: {
      entry: resolve(__dirname, "src/sandbox/hugging.js"),
      fileName: (format) => `hugging.js`,

      // Won't minify even after specifying esbuild options
      // https://github.com/vitejs/vite/issues/6079
      // Doesn't make a difference of move than 1kB
      // So ignoring as it's locally downloaded either way
      formats: ["es"],
    },
    sourcemap: true,
    minify: "esbuild",
    target: "esnext",
  },
});
