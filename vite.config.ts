import { resolve } from "node:path";

import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

import { fetchCards } from "./build/fetch-cards";
import { fetchModel } from "./build/fetch-model";
import { stripOrtWasm } from "./build/strip-ort-wasm";

// Bundle stats land at dist/stats.html on every build. The
// rollup-plugin-visualizer emits a single self-contained file, so
// PR reviewers can pull the deploy preview and open the report
// directly — no extra commands.
const analyze = visualizer({
  filename: "dist/stats.html",
  template: "treemap",
  gzipSize: true,
  brotliSize: true,
  emitFile: false,
});

export default defineConfig({
  base: "./",
  // Plugin order is significant: fetchCards writes cards.meta.ts
  // before fetchModel reads it for the cardSetVersion cross-check.
  plugins: [fetchCards(), fetchModel(), stripOrtWasm(), analyze],
  resolve: {
    alias: {
      // `@bjorvack/lorcana-schemas` imports `createHash` from `crypto`
      // at top level. The web app never invokes it; shim it so the
      // browser bundle can resolve the import.
      crypto: resolve(__dirname, "build/crypto-browser-shim.ts"),
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
