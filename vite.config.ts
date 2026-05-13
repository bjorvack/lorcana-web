import { defineConfig } from "vite";

export default defineConfig({
  // TODO: add fetch-cards + fetch-model plugins (see build/).
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
