/**
 * Runtime view of ``model-manifest.json``.
 *
 * The build-time plugin (``build/fetch-model.ts``) downloads the
 * release's manifest into ``public/model/`` and inlines a typed
 * summary into ``src/data/model.meta.ts``. We re-export both here so
 * runtime code has one place to look for "what model are we
 * running" without reaching across the data/* boundary.
 */

import { MODEL_MANIFEST, MODEL_RELEASE_TAG } from "../data/model.meta";

export type ModelManifest = typeof MODEL_MANIFEST;

export { MODEL_MANIFEST, MODEL_RELEASE_TAG };

/** Per-asset relative URL under ``/model/``. */
export function modelAssetUrl(filename: string): string {
  // ``base: "./"`` in vite.config.ts means ``import.meta.env.BASE_URL``
  // already includes a trailing slash. Concatenating relative paths
  // is fine for both the dev server (``/model/...``) and the deployed
  // GitHub Pages subpath (``/lorcana-web/model/...``).
  return `${import.meta.env.BASE_URL}model/${filename}`;
}
