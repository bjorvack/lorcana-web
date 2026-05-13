import { defineConfig } from "vite";

import { fetchCards } from "./build/fetch-cards";

export default defineConfig({
  base: "./",
  plugins: [fetchCards()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
