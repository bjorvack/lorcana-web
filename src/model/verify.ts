/**
 * Runtime cardSetVersion + vocab consistency check.
 *
 * The build plugin already guarantees the pinned model and cards
 * agree at deploy time, but the same guard at boot catches:
 *
 *   - A user with a stale Service Worker cache from before a bump.
 *   - A future hot-swap of cards.json without bumping the model tag.
 *   - Tests that mock one but not the other.
 *
 * The check is cheap and the failure mode (silently serving wrong
 * predictions) is bad, so we always run it on first model load.
 */

import { CARD_SET_VERSION } from "../data/cards.meta";

import { type ModelManifest } from "./manifest";

export function verifyManifestAgainstCards(manifest: ModelManifest): void {
  if (manifest.sources.cardSetVersion !== CARD_SET_VERSION) {
    throw new Error(
      `Model bundle pins cardSetVersion=${manifest.sources.cardSetVersion} ` +
        `but cards.json bakes ${CARD_SET_VERSION}. ` +
        `Refresh / clear cache, or bump both tags together in src/version.ts.`,
    );
  }
}
