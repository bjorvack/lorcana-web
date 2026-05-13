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

export const CARDS_RELEASE_TAG = "cards-v2026.05.13-01";

// Until lorcana-training ships its first model-vN release (which
// itself requires tournaments-v1.0.0 + proposal/evaluator
// training), the web bundle has no model assets and AI features
// are unavailable. The build's model-fetch plugin treats `null`
// as "skip the download" so we can deploy Phase 1 without one.
export const MODEL_RELEASE_TAG: string | null = null;

export const EXPECTED_SCHEMA_MAJOR = 0;
