/**
 * Vite plugin: at build start, download the pinned cards-vN release
 * (or skip if already cached) and emit `public/cards.json`.
 * TODO: implement.
 */
import type { Plugin } from "vite";

export function fetchCards(): Plugin {
  return {
    name: "fetch-cards",
    buildStart: async () => {
      // TODO: download + verify + write public/cards.json.
    },
  };
}
