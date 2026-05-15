/**
 * Release tags pinned at build time. Bumped via reviewed PR.
 *
 * Bumping ``CARDS_RELEASE_TAG`` without simultaneously bumping
 * ``MODEL_RELEASE_TAG`` to a model that was trained on that
 * ``cards-vN`` will fail the model fetch plugin's cross-check
 * (see ``build/fetch-model.ts`` once it's wired up) — by design,
 * so the deployed bundle can never have a vocab/cardset mismatch.
 *
 * ``EXPECTED_SCHEMA_MAJOR`` guards against the schemas package
 * being major-bumped underneath us; the build asserts that the
 * installed package's major version matches this value.
 */

export const CARDS_RELEASE_TAG = "cards-v2026.05.14-02";

/**
 * Optional override: pull ``banlist.json`` + ``rotation.json`` from a
 * different ``cards-vN`` than the one we pin ``cards.json`` to.
 *
 * Banlists and rotations are addressed by ``(setCode, cardNumber)``
 * so a newer ``cards-vN`` can safely supply them for an older
 * ``cards.json`` — only the model bundle is sensitive to the cardset
 * hash. Set to ``null`` to use the same tag as cards. With cards +
 * model now paired on the same scrape, no override is needed.
 */
export const LEGALITY_RELEASE_TAG: string | null = "cards-v2026.05.15-01";

// First trained release on tournaments-v0.3.0 (1 046 tournaments,
// 6 137 decks). Proposal net + per-step evaluator + play_frequency
// + archetype_centroids, all ONNX-exported and bundled. See
// https://github.com/bjorvack/lorcana-training/releases/tag/model-v0.1.0.
//
// Bump this in lock-step with CARDS_RELEASE_TAG: the build's
// fetch-model plugin enforces that the model's cardSetVersion
// equals the cards.json's cardSetVersion or the build fails.
export const MODEL_RELEASE_TAG: string | null = "model-v0.6.0";

export const EXPECTED_SCHEMA_MAJOR = 0;

/** App version, surfaced in the header for traceability. */
export const VERSION = "0.1.0";
