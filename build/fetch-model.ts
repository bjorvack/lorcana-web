/**
 * Vite plugin: at build start, download the pinned model-vN release and
 * cross-check `manifest.cardSetVersion` against the cards.json that
 * fetch-cards just wrote. Fail the build on mismatch.
 * TODO: implement.
 */
import type { Plugin } from "vite";

export function fetchModel(): Plugin {
  return {
    name: "fetch-model",
    buildStart: async () => {
      // TODO.
    },
  };
}
