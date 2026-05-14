# lorcana-web — TODO

Tracks the work needed to bring the web app from its current scaffold-
only state (file tree exists, 114 total lines of TS code across the
src tree) to a deployable product. Items are grouped by phase; we
ship Phase 1 first as a manual-deck-only build and layer AI features
on later.

DESIGN.md is the spec. This file is the checklist.

## Status legend

- [x] done
- [ ] not started
- [~] in progress / partial

---

## Phase 0 — Foundations (one-time setup, blocks everything)

- [x] Repo scaffold + DESIGN.md
- [x] `package.json` + `pnpm-workspace.yaml` pinned to pnpm 10.15.1
- [ ] Pin `@bjorvack/lorcana-schemas` to the latest published tag
      (currently `^0.1.0`; latest is `v0.4.0`). PR + bump.
- [ ] TypeScript `strict: true` confirmed in `tsconfig.json` and
      `noUncheckedIndexedAccess` enabled.
- [ ] ESLint config wired (`eslint.config.js` exists but unverified).
- [ ] Prettier config + `pnpm format` script.
- [ ] CI workflow (`.github/workflows/ci.yml`): install, lint,
      typecheck, vitest, build. Currently absent.
- [ ] `pnpm dev` boots; `pnpm build` produces a deployable bundle.

---

## Phase 1 — Manual deck builder MVP

The user can pick inks, search and add cards, build a 60+ card
legal deck, and export to inktable. No AI, no model bundle, no
worker.

### Build-time card data

- [ ] `build/fetch-cards.ts` Vite plugin:
  - Resolve `CARDS_RELEASE_TAG` from `src/version.ts`.
  - Download `cards.json` from the `bjorvack/lorcana-scraper` release.
  - Validate with `CardSet.parse` from `@bjorvack/lorcana-schemas`.
  - Compute `cardSetVersion` (sha256 of canonicalised cards array).
  - Emit `src/data/cards.json` + `src/data/cards.meta.ts`.
- [ ] `src/version.ts`: pin `CARDS_RELEASE_TAG = "cards-v2026.05.13-01"`.
- [ ] `src/data/cards.ts`: re-export typed cards array + lookup map
      keyed by `Card.id`.
- [ ] `src/data/legality.ts`: re-export `isTournamentLegal`,
      `computeMaxCopies` from the schemas package.
- [ ] `src/data/ink.ts`: ink list, ink-to-color mapping, ink glyph
      helpers.

### State management

- [ ] `src/state/store.ts`: tiny pub/sub store, ~30 lines. Currently
      18 lines of stub.
- [ ] `src/state/deck.ts`:
  - Deck shape: `{ inks: Ink[]; cards: Map<cardId, count>; locks: Set<cardId> }`.
  - Invariants enforced on every mutation:
    - inks length ∈ {1, 2}.
    - `count ≤ computeMaxCopies(card)`.
    - All card inks ⊆ deck inks.
    - Cards from `legality != 'legal'` are flagged but not rejected
      (mirroring the training-side decision).
  - Mutations: `addCard`, `removeCard`, `setCount`, `toggleLock`,
    `setInks`, `clearDeck`, `replaceFromSerialised`.
- [ ] `src/state/selectors.ts`: derived state:
  - Total cards, by type, by cost (mana curve).
  - Ink distribution.
  - Validity (`isTournamentLegal`) + per-card warnings.
- [ ] `src/state/url.ts`: hash-param serialisation:
  - `#inks=amber-steel` (kebab-case ink names).
  - `#deck=<base64-encoded card-id multiset>` (compact).
  - `#locks=<base64-encoded card-id set>`.
  - Round-trip parse → serialise → parse is identity.
- [ ] LocalStorage persistence for lock state across reloads (per
      DESIGN, "Lock state is persisted in localStorage").

### UI components (Web Components, vanilla)

- [ ] `<app-root>`: top-level layout + state subscriptions.
- [ ] `<ink-selector>`: chips for the 6 inks; 1-of-1 or 2-of-1
      selection.
- [ ] `<card-search>`: query + filters (type, cost, ink, keyword).
- [ ] `<card-finder>`: paginated/virtualised result list (avoid
      rendering all 2300 cards at once).
- [ ] `<card-preview>`: single-card detail panel with image + text.
- [ ] `<deck-list>`: grouped by type, sortable.
- [ ] `<deck-card-row>`: count stepper, lock toggle, name, cost
      glyph, click → preview.
- [ ] `<mana-curve>`: canvas-rendered bar chart, no chart lib.
- [ ] `<banner>`: dismissible inline message (success / warning /
      error).
- [ ] `<icon>`: ink glyphs + keyword icons.

Empty for now (deferred to Phase 2): `<style-picker>`, `<realism-pill>`.

### Card images

- [ ] Lazy-loaded from Lorcast (`<img loading="lazy" srcset>`).
- [ ] Fallback glyph when image 404s — non-critical, no banner.

### Export

- [x] Inktable-compatible base64 encoding (matches today's site).
- [x] "Copy to clipboard" + "Open in Inktable" buttons.

### Failure handling

- [ ] Missing card id in URL hash → inline warning per slot + "Update?"
      prompt with closest current id (DESIGN.md).
- [ ] No legal cards for a chosen 2-ink combo → empty finder + tip.
- [ ] Deck violates legality after URL-hash load → inline errors,
      never silent reject.

### Styling

- [ ] `src/ui/reset.css`: minimal CSS reset.
- [ ] `src/ui/theme.css`: CSS variables, light/dark via
      `prefers-color-scheme`, ink colour tokens.
- [ ] `src/ui/components.css`: per-component styling.
- [ ] Mobile-first layout; column-stack < 720 px.
- [ ] Touch targets ≥ 44×44 px.

### Accessibility (manual)

- [ ] Tab order is meaningful end to end.
- [ ] Ink chips + keyword icons have `aria-label` (not "image").
- [ ] Card finder has `aria-live` for new results.
- [ ] Deck list has arrow-key navigation between rows.
- [ ] `prefers-reduced-motion` respected for add/remove animations.

### Tests

- [ ] `tests/deck.test.ts`: every invariant in `state/deck.ts`.
- [ ] `tests/url.test.ts`: round-trip parse/serialise + `cards-vN`
      drift handling.
- [ ] `tests/legality.test.ts`: edge cases (max-copies overrides,
      ink mix, banned cards).
- [ ] `tests/e2e/happy-path.spec.ts`: pick inks → search → add 60
      cards → export. Playwright.

### CI

- [ ] `.github/workflows/ci.yml`: install, lint, typecheck, vitest,
      build, e2e.
- [ ] `.github/workflows/build.yml`: deploy `dist/` to `gh-pages`
      with `force_orphan: true` on push to main.
- [ ] Bundle-size budgets (Phase 1 targets, AI deferred):
  - Critical JS ≤ 80 kB gzipped.
  - Total static assets ≤ 1 MB gzipped (cards.json is most of it).

---

## Phase 2 — AI suggestions (after tournaments-v1.0.0 + model-vN exist)

Blocked on training shipping a `model-vN` release (which itself
needs `tournaments-v1.0.0`, proposal training, evaluator training,
ONNX export). Most code is already scaffolded but empty.

- [ ] `build/fetch-model.ts` Vite plugin:
  - Download every model asset for `MODEL_RELEASE_TAG`.
  - Validate `manifest.json` with `ModelManifest.parse`.
  - Cross-check `manifest.cardSetVersion === cardSetVersion` from
    `fetch-cards`. Build fails on mismatch.
  - Cross-check `sha256(vocab.json) === manifest.vocabHash`.
  - Copy assets to `public/assets/model/`.
- [ ] `src/version.ts`: add `MODEL_RELEASE_TAG`.
- [ ] `src/model/manifest.ts`: fetch + validate at runtime.
- [ ] `src/model/bundle.ts`: download + cache model files.
- [ ] `src/model/verify.ts`: `vocabHash` + `cardSetVersion`
      runtime checks; mark AI features unavailable on mismatch.
- [ ] `src/worker/protocol.ts`: typed message protocol (Request,
      Response, CandidateSuggestion). Stub exists (11 lines).
- [ ] `src/worker/inference.worker.ts`: ORT setup, proposal +
      evaluator forward passes, batched eval, legality mask.
- [ ] `src/worker/search.ts`: blend logic (proposalLogP + α·eval +
      γ·novelty − λ·meta_closeness).
- [ ] `src/worker/novelty.ts`: cosine sim against deck centroid +
      `play_frequency.json` table lookup.
- [ ] `src/worker/client.ts`: main-thread typed wrapper around
      `postMessage`.
- [ ] `<style-picker>`: Safe / Balanced / Brew + Advanced slider
      gated on `manifest.style_presets.interpolatable`.
- [ ] `<realism-pill>`: calibrated evaluator score (A/B/C/D grade).
- [ ] "Suggest next card" button: stream one card at a time.
- [ ] "Auto-complete to 60" button: loop Suggest, cancellable.
- [ ] Failure modes (DESIGN.md table):
  - Manifest 404 → "AI features unavailable" banner.
  - Manifest mismatch → mismatch banner + retry.
  - ORT init fail → "Your browser doesn't support..." banner.
  - Worker error during inference → disable buttons + retry.
- [ ] Bundle-size budget: total deployed payload ≤ 25 MB.

---

## Phase 3 — Polish + production

- [ ] About page (`public/about.html`): static, no JS. Lists pinned
      tags + active inference backend + "Manage analytics" link.
- [ ] Changelog page (`public/changelog.html`): auto-built from
      release notes.
- [ ] GA4 consent banner. No GA traffic / cookies without consent.
- [ ] OpenGraph image + favicon (`public/og-image.png`,
      `public/favicon.svg`).
- [ ] `.github/workflows/new-cards-reminder.yml`: daily cron that
      opens an issue when the pinned `cards-vN` or `model-vN`
      drifts behind latest upstream.
- [ ] Bundle-analyzer step in CI (rollup-plugin-visualizer or
      similar) so PRs that bloat the bundle are visible at review.

---

## Out of scope for v1 (per DESIGN.md)

- PWA / service worker / full offline.
- Localisation (English only).
- Saved decks beyond hash-param state.
- Realism explanations ("why is this deck a B?").
- Card image self-hosting.
- Sentry / external error reporting.

---

## Open questions

- Will `cardSetVersion` differ between training pipeline and scraper
  when both compute it independently? See the note in
  `lorcana-training/src/lorcana_training/cards/vocab.py` — we
  chose to reuse the scraper's published value verbatim instead of
  recomputing, so this should be a non-issue. Verify on first
  end-to-end run.
- Once `tournaments-v1.0.0` lands, how many of the 60 deck slots
  should "Auto-complete" fill at once? DESIGN says "loop until 60";
  consider streaming smaller batches for perceived responsiveness.
- For Phase 1 we accept that some scraped decks reference
  `not_legal` cards. The web app's manual builder lets the user add
  any in-vocab card regardless of `legality`; we don't actually
  filter by Core/Infinity format anywhere yet. Decision needed
  before Phase 2 ships: where does the rotation filter live?
