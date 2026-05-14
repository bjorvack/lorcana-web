# lorcana-web — TODO

Tracks the work still open after the Phase-1 + Phase-2 MVPs shipped.
DESIGN.md is the spec; this file is the rolling checklist.

## Status legend

- [x] done
- [ ] not started
- [~] in progress / partial

---

## Shipped (recap)

The full Phase-1 manual builder + Phase-2 AI generator are live at
https://bjorvack.github.io/lorcana-web/. Notably:

- Repo scaffold, CI (`ci.yml` + `build.yml`), Vite + pnpm + TS strict.
- `build/fetch-cards.ts` + `build/fetch-model.ts` plugins; verified
  cardset-version cross-check between cards-vN and model-vN.
- Deck state machine + invariants, URL-hash serialisation, localStorage
  persistence with versioned payload.
- Ink selector, card finder (paginated, lazy images), deck list with
  type groups + arrow-key navigation, mana curve canvas, type
  breakdown chips, realism pill, dismissible banner, About modal.
- Format-aware legality: `<format-selector>`, legality dots in finder
  - deck, format-aware Generate mask, Core Constructed default.
- Inktable export (legacy `svc=dreamborn` URL scheme) + plaintext
  clipboard + share-link button.
- AI worker: ONNX-Runtime-Web (WebGPU first, WASM fallback), proposal
  - evaluator, 60-card search loop, continuous Style slider, locks
    preserved across regenerate, per-card ink-mask + per-format legality
    mask.

---

## Open work

### Live realism scoring (DESIGN Q4)

- [ ] Add a `score` request type to `worker/protocol.ts` (deck +
      vocab-aligned tensor → calibrated score).
- [ ] Implement scoring in `inference.worker.ts` by reusing the
      evaluator session (no novel forward pass needed).
- [ ] Main-thread debouncer: 300 ms after the last deck mutation,
      fire one `score` call. Pause entirely during Generate.
- [ ] Show "(updating…)" annotation in `<realism-pill>` while a
      score is pending.

### AI failure banner (DESIGN Q5)

- [ ] Distinguish init failure (model bundle load / ORT init) from
      generation failure (single Generate click) on the deck-generator.
- [ ] On init failure, surface a persistent banner via `<app-banner>`
      with a Retry button that re-runs `InferenceClient.init`.
- [ ] While init has failed, disable the Generate button; manual
      building remains unaffected.

### Baked thumbnail fallback (DESIGN Q6)

- [ ] Extend `build/fetch-cards.ts` to download every card image
      from Lorcast, downscale to 64×90 WebP @ q60.
- [ ] Cache hits per-id in `node_modules/.cache/lorcana-thumbs/`.
- [ ] Emit to `public/assets/thumbs/<id>.webp`; total budget ≤500 KB.
- [ ] `bindImageFallback` swaps to the thumb on Lorcast 404 instead
      of the current first-letter glyph.

### Analytics consent + About link (DESIGN Q8)

- [ ] `<consent-banner>` at the bottom of the screen on first visit
      with Accept / Decline. No GA traffic before Accept.
- [ ] Persist choice in `localStorage` under `lorcana:analytics-consent`.
- [ ] About modal: "Manage analytics" button re-opens the banner.
- [ ] Wire GA4 only after Accept; no script tag in the page otherwise.

### Cross-repo

- [ ] Re-train the model on `cards-v2026.05.14-01` so legality data
      and cards travel together; drop the `LEGALITY_RELEASE_TAG`
      override in `src/version.ts`.

### Smaller items

- [ ] `<deck-list>` row "Update?" prompt when the URL hash references
      a card id no longer in the pool (currently silently dropped +
      surfaced via banner; per-row suggestion is nicer UX).
- [ ] Style slider snap points (Safe / Balanced / Brew) with a
      small "(interpolated)" annotation between snaps, per DESIGN Q2.
- [ ] Bundle-analyzer step in CI so a future PR's bundle bloat is
      visible at review.

---

## Out of scope for v1 (unchanged from DESIGN.md)

- PWA / service worker / full offline.
- Localisation (English only).
- Saved-deck slots beyond URL hash + localStorage.
- Realism explanations ("why is this deck a B?").
- Card image self-hosting (beyond the baked thumbnail fallback above).
- Sentry / external error reporting.

---

## Open questions

- Once we have live realism scoring, what's the smallest dataset
  change that should bust the cached score? Currently we re-score
  on every cards change; verify the eval session is cheap enough
  for that not to matter.
- Should the share-link URL strip the `format=` param when the user
  is on the boot-default format? Today we already do that in
  `state/url.ts`, but the boot default is hard-coded to Core; if
  we ever expose a settings page to flip the default, this would
  need to read the same source as the chip.
