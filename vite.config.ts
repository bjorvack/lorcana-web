import { resolve } from "node:path";

import { defineConfig } from "vite";

import { fetchCards } from "./build/fetch-cards";
import { fetchModel } from "./build/fetch-model";

export default defineConfig({
  base: "./",
  // Plugin order is significant: fetchCards writes cards.meta.ts
  // before fetchModel reads it for the cardSetVersion cross-check.
  plugins: [fetchCards(), fetchModel()],
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
