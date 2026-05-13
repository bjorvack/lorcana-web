# lorcana-web — Design

> The user-facing deck builder. A fully static site of HTML, CSS, and
> JavaScript served from GitHub Pages. Pinned `cards-vN` and `model-vN`
> are both downloaded and bundled at build time, so every visit is
> self-contained: no runtime calls to GitHub Releases, Lorcast, or any
> other origin (except optional card images). Inference runs locally in
> a Web Worker with ONNX Runtime Web.

## Purpose

This is the only consumer of `cards-vN` and `model-vN` that real users
ever see. Everything else in the system exists to make this app good.

The job is narrow: let a person pick 1–2 inks, build a 60+ card deck,
get useful AI suggestions for the gaps, and export the result. It must
work on a phone, never blank-screen on a model failure, and respect the
contracts established by the other three repos.

Hosting constraints worth being explicit about:

- **GitHub Pages serves the site.** Everything is static HTML / CSS /
  JS / WASM / `.onnx` / `.bin`. No server, no functions, no edge
  worker.
- **No runtime cross-origin fetches** to GitHub Releases. The model
  bundle is downloaded once during the CI build and committed into
  the deployed `gh-pages` payload. From the browser's perspective
  everything except optional card images lives at the Pages origin.
- **Card images are the only cross-origin runtime fetch** (from
  Lorcast). They are non-critical: a broken image shows a fallback
  glyph and the rest of the UI keeps working.
- **No backend we own.** No analytics endpoints we host, no error
  reporting endpoints, no user accounts, no deck-cloud-save. The one
  third-party service the app touches at runtime, beyond Lorcast
  images, is **Google Analytics 4** — and only after the user
  explicitly consents via the cookie banner (see open question 8).
  Without consent, no GA traffic and no GA cookies. Anything
  beyond that needs another external service the user explicitly
  opts into.

## Non-goals

- Server-side rendering. The whole app is static.
- User accounts, deck cloud-save, sharing infrastructure. We link to
  inktable.net / dreamborn-style services for sharing, like today.
- Game simulation. We do not play out matches in-browser.
- Manual heuristic deck generation. The current project's
  `WeightCalculator` is replaced by neural search; we don't ship two
  generators.
- Training, fine-tuning, or RL anywhere in the browser.
- Card data fetching at runtime. The whole `cards-vN` is baked into
  the bundle at build time.

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Catches the silent index-shift bugs the current project's plain JS code is full of. |
| Bundler / dev server | Vite | Fast dev loop, no config gymnastics, ESM output. |
| UI | Vanilla DOM + Web Components | User constraint: HTML/CSS/JS only. Web Components give us reusable primitives without a framework runtime. |
| State | A small in-house store (~30 lines, pub/sub) | Framework would be overkill; raw events would be hard to test. |
| Styling | Plain CSS + CSS variables, light/dark via `prefers-color-scheme` | Matches the no-framework constraint, easy to theme. |
| Inference | [`onnxruntime-web`](https://onnxruntime.ai/docs/get-started/with-javascript/web.html) in a Web Worker | Fast (WASM + WebGPU), official, ONNX is the format the training pipeline already exports. |
| Schema | `@bjorvack/lorcana-schemas` (npm) | Same source of truth as the rest of the system. |
| Test | Vitest (unit) + Playwright (one end-to-end smoke) | Same tooling as scraper. |
| Lint/format | ESLint + Prettier | Consistent with other TS repos. |
| Deploy | GitHub Pages from `gh-pages` branch | Matches current setup. |

Deliberately not chosen:
- React / Vue / Svelte / Solid. The user constraint is "vanilla". Even
  setting that aside: this app has maybe 20 components and very simple
  state; a framework's runtime cost outweighs its DX gain at this size.
- TFJS. We use ONNX because that's what `lorcana-training` exports;
  ONNX Runtime Web is also significantly faster for our model shapes.
- A CSS framework. Tailwind / Pico / etc. would be 80% unused; a few
  hundred lines of hand-written CSS is smaller and clearer.
- Service workers / PWA. Out of scope for v1 (see "Out of scope").

---

## What loads when

Everything except card images lives at the GitHub Pages origin and is
either inlined or fetched from the same domain.

```
   t=0     navigate to /
           │
           ▼
           HTML + CSS + critical JS         (≤ 60 kB gzipped)
           │
           ▼
   t≈200ms  First Contentful Paint
           │   user sees the deck builder shell, can pick inks,
           │   start browsing cards
           │
           ▼
           cards.json (inlined into the JS bundle as ESM import)
           │  user can build a deck by hand
           │
           ▼
           in parallel, asynchronously:
             ┌──────────────────────────────────────┐
             │ fetch /assets/model/manifest.json    │
             │  (~1 kB, same origin)                │
             └──────────────┬───────────────────────┘
                            ▼
             ┌──────────────────────────────────────┐
             │ validate manifest.cardSetVersion     │
             │ against bundled cards.json hash      │
             │ + manifest.vocabHash against the     │
             │ bundled vocab.json                   │
             │                                      │
             │ MISMATCH → mark AI features          │
             │           unavailable, show banner   │
             └──────────────┬───────────────────────┘
                            ▼
             ┌──────────────────────────────────────┐
             │ fetch model assets from same origin: │
             │   /assets/model/proposal.int8.onnx   │
             │   /assets/model/evaluator.int8.onnx  │
             │   /assets/model/card_embeddings.bin  │
             │   /assets/model/play_frequency.json  │
             │   /assets/model/archetype_centroids… │
             │   /assets/model/evaluator_calibrat…  │
             │ ~10 MB total, all cache-busted via   │
             │ content hash in the filename         │
             └──────────────┬───────────────────────┘
                            ▼
             ┌──────────────────────────────────────┐
             │ worker.postMessage("init", bundle)   │
             │   worker boots ORT, loads ONNX,      │
             │   pre-computes embeddings tensor     │
             └──────────────┬───────────────────────┘
                            ▼
   t≈3–6s    AI features enabled (Suggest, Style, Realism score)
```

Why everything is same-origin:

- **No GitHub Releases CORS dependency.** Release-asset URLs
  redirect through `objects.githubusercontent.com`, which has had
  inconsistent CORS behaviour. Bundling sidesteps the question
  entirely.
- **Atomic deploys.** The site, the cards snapshot, and the model
  bundle are committed together in a single `gh-pages` payload. They
  cannot disagree at runtime — if a deploy is on the site, the
  model that matches it is also on the site.
- **Cache invalidation is automatic.** Vite emits hashed filenames
  (`proposal.<hash>.onnx`); browsers cache aggressively, a new
  release ships new hashes, no manual cache-buster headers needed.

Two design choices that still matter:

- **The user is never blocked on the model.** Manual deck building
  works the moment `cards.json` is in memory. The "Suggest" button
  shows a spinner until the worker reports ready; everything else
  stays interactive.
- **Manifest check before use.** Even though the manifest, the
  model, and the cards.json are all bundled together (so they
  *should* agree by construction), we still verify
  `cardSetVersion` and `vocabHash` at runtime. Catches a botched
  build that committed mismatched assets — the build's own
  verification step (see CI section) should catch this earlier, but
  the runtime check is the last line of defence.

The bundling has a real cost: each model release adds ~10 MB to the
deployed payload. Mitigations:

- The `gh-pages` deploy is **force-orphan** (each deploy is a single
  commit with no history). Git history doesn't accumulate model
  bytes over time.
- Model files are served with long `Cache-Control` (handled by
  GitHub Pages defaults + Vite's hashed filenames).
- A new model release means a new build, not a runtime download.
  Acceptable because model releases are deliberate (Q6 in the
  training repo: `workflow_dispatch` only).

---

## Information architecture

The current project has two pages (`/` deck builder, `/ai-generator`).
The new app collapses them: the AI is good enough to be the primary
generation tool, and the heuristic generator has been retired (Q1). One
page is enough:

```
/                        ← single deck builder (AI suggestions inline)
/about                   ← short page describing the system, lists pinned model release,
                           shows the active inference backend, "Manage analytics" link
/changelog               ← what changed between releases (auto-built from release notes)
```

Sub-routing inside the deck builder uses URL hash params, not
client-side routing, so deep links work without a router:

- `#inks=amber-steel`
- `#deck=base64-encoded-card-id-multiset`
- `#style=brew`

A URL with all three is enough to restore a deck from a shared link.

---

## The deck-builder page

```
┌─────────────────────────────────────────────────────────────────┐
│ Lorcana Deckbuilder                                             │
├─────────────────────────────────────────────────────────────────┤
│  Inks:  [ Amber ●] [ Amethyst ] [ Emerald ] …                   │
│                                                                 │
│  Style: ( Safe   Balanced   Brew )    [ ⓘ ]                     │
│                                                                 │
│  [ Suggest next card ]   [ Auto-complete to 60 ]    [ Clear ]   │
├──────────────────────────────┬──────────────────────────────────┤
│  Deck (52 / 60)              │  Card finder                     │
│  ───────────────────────     │  ──────────────────────          │
│  4× Aurora — Dawning Beauty  │  [ search … ]                    │
│  4× Mickey Mouse — …         │  ┌─────────────────────────────┐ │
│  …                           │  │ Aurora — Dawning Beauty 1/4 │ │
│                              │  │ ⬢  3  ◆ 2  ⚔ 2  ♥ 3         │ │
│  Mana curve:  [bar chart]    │  └─────────────────────────────┘ │
│  Realism:    72% (B)         │  …                               │
│                              │                                  │
│  [ Export to inktable ]      │                                  │
└──────────────────────────────┴──────────────────────────────────┘
```

Key behaviours:

- **Inks** is a 1-of-1 or 2-of-1 selector. Picking a single ink first,
  then adding a card from another ink, auto-promotes to that ink pair.
  Cards in the deck that no longer fit the inks are removed
  (confirmation modal).
- **Style** is three buttons (Safe / Balanced / Brew). They map to the
  three `style_presets` tuples in `manifest.json`. We do **not** show
  the numbers; underlying `(α, γ, λ)` weights are in `manifest.json`.
  An optional "Advanced" disclosure reveals a single 0–1 slider with
  snap points at the three presets and linear interpolation between
  them, gated on `manifest.style_presets.interpolatable` (see Q2).
- **Suggest next card** finds the single most appropriate next card
  under the current Style and adds it. **Auto-complete to 60** loops
  Suggest until the deck has 60 cards. Both stream cards into the UI
  one at a time so the user sees progress and can cancel.
- **Lock cards.** Every deck row has a padlock icon: tap (or click)
  toggles lock state, outline → unlocked, filled → locked.
  Suggest / Auto-complete never removes or replaces a locked row;
  locked rows still count toward the 60-card total. Right-click on
  desktop is a power-user shortcut for the same toggle. Lock state
  is persisted in `localStorage` and encoded into shareable URLs.
  Full details: Q10.
- **Mana curve, realism, type breakdown** update reactively as the
  deck changes. The realism number is the **calibrated evaluator
  score** on the current deck (the validator score, but well-named —
  it's "how plausible does the system think this deck is", not "how
  well will it win").
- **Export** copies a base64-encoded card-id multiset to the
  clipboard and opens the inktable.net import URL with that payload,
  same UX as today.

### Failure modes the UI must handle

| Scenario | Behaviour |
|---|---|
| Model manifest 404 (corrupted deploy) | Banner: "AI features unavailable. You can still build a deck manually." |
| Manifest `cardSetVersion` / `vocabHash` mismatch (botched build slipped past CI) | Banner explaining the mismatch + retry button; all AI features off, manual building untouched |
| `onnxruntime-web` fails to initialise (e.g. very old browser without WASM) | Banner: "Your browser doesn't support the AI features. Manual building works." |
| Worker errors during inference | Disable AI buttons, log to console, banner with retry |
| Card image 404 from Lorcast | Replace with a typed fallback glyph; no banner, single image is non-critical |
| User picks a 2-ink combination with no legal cards in `cards-vN` | Show empty card finder + tip |
| Deck violates legality after a card was edited externally (e.g. URL hash) | Show validation errors inline next to the offending cards, never reject silently |
| User loads a URL with a `deck` param referencing card ids not in the bundled `cards-vN` | Show inline warnings on the affected slots, prompt "Update?" with the closest current id |

The current project uses `alert()` for all of these. The new app uses
**inline banners and inline validation errors** only. No modal popups
for errors.

---

## The inference contract

Everything below the worker boundary is concentrated in
`src/worker/inference.worker.ts`. The main thread talks to it through
a tiny typed message protocol:

```ts
// src/worker/protocol.ts
export type Request =
  | { type: "init"; bundle: ModelBundle }
  | { type: "score"; deck: DeckSnapshot }
  | { type: "suggest"; deck: DeckSnapshot; style: StylePreset; n: number };

export type Response =
  | { type: "ready" }
  | { type: "score"; realism: number; grade: "A" | "B" | "C" | "D" }
  | { type: "suggest"; cards: CandidateSuggestion[] };

export interface CandidateSuggestion {
  cardId: string;
  score: number;        // the blended score
  breakdown: {
    proposalLogP: number;
    evaluator: number;
    novelty: number;
    metaCloseness: number;
  };
}
```

The worker has no DOM access and no knowledge of the UI; the main
thread has no knowledge of ONNX. Either side can be replaced
independently.

### Inside `inference.worker.ts`

```ts
async function suggest(deck: DeckSnapshot, style: StylePreset): Promise<CandidateSuggestion[]> {
  // 1. Build legality mask: legal × in-ink × under maxCopies
  const mask = buildLegalityMask(deck, vocab, cards);

  // 2. Run proposal: ~5 ms on a modern phone with WASM
  const proposalLogits = await runProposal(deck, inkVector);
  const proposalLogP = logSoftmaxMasked(proposalLogits, mask);

  // 3. Take top-K candidates from proposalLogP (K = 32 by default,
  //    tuned for end-to-end suggestion time on mobile).
  const topK = topKIndices(proposalLogP, 32);

  // 4. Score those K with the evaluator (single batched call)
  const evalScores = await runEvaluatorBatched(deck, topK);

  // 5. Compute novelty + meta_closeness deterministically in JS
  //    using card_embeddings.bin + play_frequency.json
  const novelty = topK.map(i => computeNovelty(deck, i, cardEmbeddings));
  const metaCloseness = topK.map(i => computeMetaCloseness(deck, i, playFreq));

  // 6. Blend
  const final = topK.map((i, k) =>
    proposalLogP[i]
    + style.alpha   * evalScores[k]
    + style.gamma   * novelty[k]
    - style.lambda  * metaCloseness[k]
  );

  // 7. Argmax (Suggest = 1) or nucleus sample (Auto-complete = mix
  //    of argmax with a small temperature for variety across slots).
  return final
    .map((score, k) => ({ cardId: vocab[topK[k]], score, breakdown: { … } }))
    .sort((a, b) => b.score - a.score);
}
```

Key properties:

- **Hard constraints are a mask, not a term.** A card that's illegal
  has `-Infinity` in the mask; it cannot win the argmax no matter
  what the model thinks. This is the single biggest behavioural
  difference vs. today's stack of post-hoc filters.
- **Evaluator is batched.** One ONNX call evaluates all top-K
  candidates at once, not K calls. With K = 32 this is one Evaluator
  forward pass for the entire Suggest action.
- **Novelty and meta-closeness are deterministic.** No model calls.
  Both reduce to cosine similarity / table lookup over data shipped
  in the model bundle. Cheap, fast, fully explainable.
- **Streaming.** Auto-complete calls `suggest()` repeatedly, posting
  one card at a time back to the main thread. The UI can render
  progress and the user can cancel; the worker checks an abort flag
  between iterations.

### Compute budget

Targets on a mid-range phone (Pixel 6 class), WASM backend:

| Action | Wall-clock |
|---|---|
| Worker init (load both ONNX, embeddings) | ≤ 3 s |
| Single `score` call | ≤ 80 ms |
| Single `suggest` call (one card) | ≤ 200 ms |
| Auto-complete to 60 from empty | ≤ 6 s for the remaining 60 cards |

These are budgets, not commitments. If we miss them we look at:
- WebGPU backend (often 3–5× faster on modern devices, but flaky on
  iOS Safari — fallback to WASM if init fails).
- Reducing K from 32 to 16 (halves evaluator cost, small quality drop).
- Switching to fp16 ONNX where the device supports it.

---

## Project layout

```
lorcana-web/
├── DESIGN.md
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   ├── favicon.svg
│   ├── og-image.png
│   └── about.html              # static, no JS
├── src/
│   ├── main.ts                 # entry; mounts <app-root>
│   ├── version.ts              # MODEL_RELEASE_TAG, CARDS_RELEASE_TAG
│   ├── state/
│   │   ├── store.ts            # tiny pub/sub store
│   │   ├── deck.ts             # deck state + invariants
│   │   ├── selectors.ts        # derived state (curve, type mix, etc.)
│   │   └── url.ts              # hash-param serialiser
│   ├── components/
│   │   ├── app-root.ts
│   │   ├── ink-selector.ts
│   │   ├── style-picker.ts
│   │   ├── deck-list.ts
│   │   ├── deck-card-row.ts
│   │   ├── card-finder.ts
│   │   ├── card-search.ts
│   │   ├── card-preview.ts
│   │   ├── mana-curve.ts       # canvas, no chart lib
│   │   ├── realism-pill.ts
│   │   ├── banner.ts
│   │   └── icon.ts             # ink glyphs, keyword icons
│   ├── data/
│   │   ├── cards.ts            # imports cards.json (generated at build)
│   │   ├── max-copies.ts       # re-export from @bjorvack/lorcana-schemas
│   │   ├── legality.ts         # isTournamentLegal (re-export)
│   │   └── ink.ts              # ink utilities
│   ├── worker/
│   │   ├── inference.worker.ts # ORT, no DOM
│   │   ├── client.ts           # main-thread typed wrapper around postMessage
│   │   ├── protocol.ts         # shared types (worker ↔ main)
│   │   ├── search.ts           # blend logic; runs in worker
│   │   └── novelty.ts          # cosine + freq table lookups
│   ├── model/
│   │   ├── manifest.ts         # download + validate manifest.json
│   │   ├── bundle.ts           # download model files, cache
│   │   └── verify.ts           # vocabHash + cardSetVersion checks
│   ├── ui/
│   │   ├── theme.css
│   │   ├── reset.css
│   │   └── components.css
│   └── utils/
│       ├── log.ts
│       ├── debounce.ts
│       └── error-boundary.ts
├── build/
│   ├── fetch-cards.ts          # build-time: download cards-vN release
│   └── fetch-model.ts          # build-time: download model-vN release + cross-check
├── tests/
│   ├── deck.test.ts
│   ├── url.test.ts
│   ├── search.test.ts
│   └── e2e/
│       └── happy-path.spec.ts  # Playwright
└── .github/workflows/
    ├── ci.yml
    ├── build.yml               # build + deploy to gh-pages on main push
    └── new-cards-reminder.yml  # daily: open issue if cards-vN drifted
```

---

## Build-time pinning

Two release tags are pinned in `src/version.ts`:

```ts
export const CARDS_RELEASE_TAG = "cards-v2025.05.01-01";
export const MODEL_RELEASE_TAG = "model-v0.7.0";
```

Both are resolved at **build time**. The site that gets deployed is a
single self-contained artifact; the running browser makes no fetches
to GitHub Releases.

### `build/fetch-cards.ts` (Vite plugin)

1. Downloads `cards-v.../cards.json` from `lorcana-scraper`'s releases
   using the GitHub API (no auth required for public releases).
2. Validates with `CardSet.parse` from `@bjorvack/lorcana-schemas`.
3. Computes `cardSetVersion` (sha256 of canonicalised cards array).
4. Emits `src/data/cards.json` and `src/data/cards.meta.ts`
   exporting `cardSetVersion`.
5. Fails the build if the tag isn't a valid release or the payload
   fails schema validation.

### `build/fetch-model.ts` (Vite plugin)

1. Downloads every asset from the pinned `model-v...` release:
   `proposal.int8.onnx`, `evaluator.int8.onnx`,
   `card_embeddings.bin`, `vocab.json`, `play_frequency.json`,
   `archetype_centroids.json`, `evaluator_calibration.json`,
   `manifest.json`.
2. Parses `manifest.json` with `ModelManifest.parse` from
   `@bjorvack/lorcana-schemas`. Fails on any error.
3. **Cross-checks against the cards plugin's output**:
   - `manifest.cardSetVersion === cardSetVersion` from `fetch-cards`.
   - `sha256(vocab.json) === manifest.vocabHash`.
   Fails the build on mismatch. This is the cardinal compatibility
   check; the runtime version is the safety net, this is the gate.
4. Copies all eight files into `public/assets/model/` so they end up
   at `/assets/model/<name>` in the deployed site.
5. Emits `src/data/model.meta.ts` exporting the resolved file paths
   (post-hash), the tag, and the verified hashes for the runtime
   check.

If either plugin fails, the build fails. No silently-broken deploys.

### Bumping a pin

Bumping `CARDS_RELEASE_TAG` or `MODEL_RELEASE_TAG` is a small PR; the
`new-cards-reminder` workflow opens an issue when either drifts behind
the latest upstream release. Bumping `CARDS_RELEASE_TAG` without
simultaneously bumping `MODEL_RELEASE_TAG` to a model that was trained
on that cards-vN will fail step 3 of `fetch-model` — so you can't
accidentally deploy a mismatched pair.

---

## Reliability and accessibility

- **Inline error reporting** instead of `alert()`. Every error has a
  user-facing banner and a stack-trace logged to the browser console.
  No external error-reporting service in v1 (Q7).
- **Keyboard navigation everywhere.** Tab order is meaningful;
  card-finder has `aria-live` for new results; deck list has
  arrow-key navigation between cards.
- **Screen-reader labels.** Every iconic element has `aria-label`.
  Ink chips and keyword icons announce the ink/keyword name, not
  "image".
- **Reduced motion.** Respect `prefers-reduced-motion` for the card
  add/remove animations.
- **Touch targets ≥ 44×44 px** for primary actions.
- **No layout shift** during model load: the AI buttons take up
  their final size from the start, with a spinner inside.

---

## CI / deploy

### `ci.yml` — every PR / push

- `pnpm install --frozen-lockfile`
- `pnpm lint`, `pnpm typecheck`
- `pnpm test` (Vitest unit)
- `pnpm test:e2e` (one Playwright happy-path: pick inks, add a card,
  observe deck count update). E2E does not require a real model — it
  uses a fixture worker that returns hand-written suggestions.
- `pnpm build` (full Vite build, including `fetch-cards` and
  `fetch-model`). Fails if either release cannot be fetched, fails
  schema validation, or the cross-check between them fails.
- Bundle-size checks:
  - Critical JS (main bundle, no async chunks) ≤ 80 kB gzipped.
  - Total non-model static assets (JS, CSS, fonts, `cards.json`,
    icons) ≤ 1 MB gzipped.
  - Total deployed payload (including model assets) ≤ 25 MB. Builds
    that exceed this fail with a clear message; we revisit the
    quantisation strategy in `lorcana-training` if we hit it.

### `build.yml` — deploy on push to `main`

- Re-runs `ci.yml` on the merged commit.
- Deploys `dist/` to the `gh-pages` branch using
  `peaceiris/actions-gh-pages` with `force_orphan: true` so the
  branch holds exactly one commit at any time — the model bytes
  don't accumulate in git history across releases.
- No coupling to scraper or training workflow runs. Bumping
  `CARDS_RELEASE_TAG` or `MODEL_RELEASE_TAG` is just another commit
  to `main`; the same workflow re-runs and produces a fresh deploy
  with the new artifacts.

### `new-cards-reminder.yml`

Mirror of the training repo's version:
- Daily cron, compares latest `cards-vN` and latest `model-vN` against
  `src/version.ts`.
- Opens an issue with a checklist if either drifted:
  - [ ] Bump `CARDS_RELEASE_TAG` and/or `MODEL_RELEASE_TAG`.
  - [ ] Test locally with `pnpm dev`.
  - [ ] Open PR.
- Idempotent (one issue per latest-tag value).

---

## Out of scope for v1

- PWA / service worker / full offline. The model bundle would be
  cacheable, but managing cache invalidation across model releases is
  enough complexity to defer.
- Localisation. English only.
- Saved decks (`localStorage` beyond hash-param state). Hash params
  give shareable URLs; that's enough for v1.
- Realism explanations ("why is this deck a B?"). Would need per-card
  attribution from the evaluator; defer until we know it's wanted.
- Multi-deck side-by-side comparison.
- Theme customisation beyond light/dark auto.

---

## Open questions to resolve before implementing

1. **One page or two.** *Decided: one page.* `/` is the deck builder.
   AI suggestions, the Style control, and the Realism score live as
   inline elements within it. The heuristic `WeightCalculator` from
   the current project is not ported. There is one product — building
   a Lorcana deck — and it gets one page. AI is a tool inside that
   product, not a separate product.

   Discoverability mitigation: when the deck has cards but the user
   hasn't yet used Suggest or Auto-complete in this session, a
   subtle inline hint (`"Suggest can help fill in the gaps →"`)
   appears next to the AI buttons. Dismissable; remembered in
   `localStorage` so it shows at most a few times.
2. **Where the Style control lives.** *Decided: three buttons +
   Advanced slider.*

   Primary UI is a three-button segmented control (Safe / Balanced /
   Brew). The three positions read directly from
   `manifest.style_presets`.

   An "Advanced" disclosure (collapsed by default) reveals a single
   0–1 slider with snap points at the three presets:
   - 0.0 → Safe preset
   - 0.5 → Balanced preset
   - 1.0 → Brew preset
   - intermediate values → linear interpolation in `(α, γ, λ)`-space
     between adjacent presets.

   The slider has a known risk: the three presets are calibrated
   independently and the line between them isn't guaranteed to be
   well-behaved. Mitigations:
   - During training-pipeline eval, we add an "intermediate Style
     coherence" diagnostic that samples ~32 decks at slider
     positions 0.25 and 0.75 and reports their novelty metrics. If
     they're not strictly monotone between the adjacent presets, the
     eval-report.md flags it.
   - The web app shows a small "(interpolated)" annotation on the
     slider whenever it's not at one of the three snap points, so
     users know the in-between behaviour is best-effort.

   If the diagnostic ever shows the interpolation is unreliable on
   real models, the Advanced disclosure hides the slider until the
   problem is fixed in training — feature flagged by a flag in the
   manifest (`style_presets.interpolatable: boolean`).
3. **Inference backend.** *Decided: WebGPU first, WASM fallback.*

   At worker init:
   1. Attempt to create an ORT session with the `webgpu` execution
      provider.
   2. On any failure (no `navigator.gpu`, init throws, first inference
      throws inside a probe), tear down and re-init with `wasm`.
   3. Record the active backend in a worker-scoped variable; expose
      via a `{type: "diagnostics"}` message so the main thread can
      show it in About.
   4. Log both attempts (success or failure) to the console with a
      consistent prefix so support requests can grep for them.

   The About page shows the active backend as read-only text, e.g.
   "Inference backend: WebGPU (Auto)". No user-facing toggle in v1;
   if users report perf issues that turn out to be backend-related,
   we add a toggle in v1.x.

   Perf budget targets from earlier in this doc are stated for the
   WASM backend; WebGPU should beat them comfortably. We don't ship
   two sets of targets — WASM is the floor.
4. **Realism score: live vs. on-demand.** *Decided: 300 ms debounce,
   paused during Auto-complete.*

   Behaviour:
   - On any deck change (add / remove / lock), schedule a `score`
     worker call after 300 ms of inactivity. Subsequent changes
     within the window reset the timer.
   - During an Auto-complete run, scoring is paused entirely. The
     UI shows the most recent score with a "(updating…)" annotation.
     A single `score` call fires when Auto-complete finishes.
   - During a single Suggest, no special handling — Suggest is fast
     enough that the 300 ms debounce handles it naturally.
   - The Realism display shows a faint spinner whenever a score is
     pending (either debounced or paused). The number itself never
     blanks; we always show the last known value with a "(updating…)"
     suffix so the UI doesn't flicker.
   - If a `score` call is in flight and the deck changes again, the
     worker's in-flight call is allowed to finish (its result is
     ignored) and a new one is scheduled. No cancel API in ORT-web
     today.
5. **Failed-model UX.** *Decided: disable all four AI features with a
   banner + retry button.*

   AI features are a single coordinated state: **on** or **off**.
   When off, **Suggest**, **Auto-complete**, **Realism score**, and
   **Style picker** are all disabled (greyed, not hidden). Manual
   building, card finder, mana curve, type breakdown, and deck list
   are unaffected.

   A persistent inline banner explains the cause in plain language,
   keyed off the failure type:
   - "Your browser doesn't support the AI features. You can still
     build a deck manually." (no WebGPU and no WASM at all)
   - "The AI model didn't load. This is usually temporary." (network
     or transient init failure)
   - "The AI model files appear to be missing from this deploy."
     (asset 404 — should never happen post-build verification, but a
     real-world possibility)
   - "The AI worker crashed. Try again." (mid-session worker error)

   The banner has a **Retry** button that re-runs worker init from
   scratch (re-fetching the assets if they failed to load originally,
   re-creating the ORT session if init failed). If retry succeeds,
   the banner is dismissed and AI features re-enable. If retry fails,
   the banner stays.

   We deliberately do not try to distinguish "Suggest could work but
   evaluator failed". Either every AI feature works or none do; the
   coherence of the user experience matters more than squeezing a
   partial feature out of a half-broken state.
6. **Image hosting.** *Decided: Lorcast primary, baked thumbnail
   fallback.*

   Two-tier image strategy:
   - **Primary:** Lorcast image URL, hot-linked via standard `<img
     src>`. Full quality, zero infra, always current. Loaded lazily
     (`loading="lazy"`).
   - **Fallback:** a 64×90 px WebP thumbnail of every card, baked
     into the deployed bundle at build time (`/assets/thumbs/<id>.webp`).
     Total size budget: ≤ 500 KB for the entire set. An `onerror`
     handler on every card `<img>` swaps to the thumbnail.

   Build step (added to `build/fetch-cards.ts`):
   1. After downloading and validating `cards.json`, fetch each
      card's image from Lorcast.
   2. Downscale + recompress to WebP at quality 60.
   3. Cache per `Card.id` in `node_modules/.cache/lorcana-thumbs/` so
      unchanged cards aren't re-downloaded on subsequent builds.
   4. Bundle into `public/assets/thumbs/`.

   Build fails if the **total** thumbnail set exceeds 500 KB or if
   any individual thumbnail fails to generate; the latter implies
   Lorcast is partly broken at build time and we want to fail loudly
   rather than ship a half-thumbed bundle.

   Why both:
   - In normal operation users see full-quality Lorcast images.
   - If Lorcast is slow / down / changes URL structure, the entire
     card finder stays visually usable instead of becoming a wall of
     broken-image icons.
   - The cost (~500 KB once, cached forever via Vite-hashed paths)
     is a rounding error compared to the model bundle.
7. **Telemetry / error reporting.** *Decided: nothing in v1.*

   No Sentry, no analytics endpoint, no custom webhook. The static
   site sends no telemetry of any kind. Error visibility is whatever
   the browser console + user-reported screenshots give us. If a
   user opens an issue with a console log, we have what we need.

   The About page lists what the app does and does not send:
   - On every visit: loads static assets from the Pages origin and
     card images from Lorcast.
   - On every visit, **if Google Analytics consent was given**
     (open question 8): standard GA4 pageview + custom event
     traffic. Otherwise no analytics traffic.
   - No cookies beyond GA's own (and only if consent was given).
   - `localStorage` is used only for: the analytics-consent choice,
     the one-shot UI hints, and the user's own deck state (deck
     contents, inks, current Style).

   Revisit if we ever find that real-world bugs are silently going
   unreported. The natural next step would be the opt-in Sentry
   path; nothing else in the architecture forecloses it.
8. **Anonymous usage analytics.** *Decided: Google Analytics 4
   behind a GDPR-compliant consent banner.*

   GA4 is integrated for product visibility, with the explicit
   trade-off that the site needs a proper consent flow before the
   script fires.

   **Consent flow:**
   - On first visit, GA4 is **not** loaded. A non-blocking banner
     appears at the bottom of the screen with an honest message
     ("We use Google Analytics to learn which features get used.")
     and two equally-weighted buttons: **Accept** and **Decline**.
   - The page is fully interactive behind the banner — building a
     deck is not blocked. AI features load normally regardless of
     the consent choice.
   - **Accept:** GA4 script tag is injected; from then on,
     standard pageviews + custom events fire. The `_ga` cookie
     gets set.
   - **Decline:** GA never loads. No GA cookies, no traffic.
   - The choice is persisted in `localStorage` under
     `lorcana:analytics-consent` with a timestamp and the consent
     version (so a future consent-policy change can re-prompt).
   - The About page has a **"Manage analytics"** link that opens the
     banner again for users to revisit their choice.

   **What we track when consent is given:**
   - Page views (default GA).
   - `ai_init_started`, `ai_init_completed`, `ai_init_failed`
     (with a coarse failure reason: `webgpu_failed`, `wasm_failed`,
     `assets_404`, `worker_crashed`).
   - `suggest_clicked`, `autocomplete_clicked`,
     `autocomplete_completed`.
   - `style_changed` with the style name as a parameter (`safe`,
     `balanced`, `brew`, `custom`).
   - `card_added_manual`, `card_removed`.
   - `ink_picked`.
   - `export_clicked`.

   We deliberately do **not** track:
   - Specific card ids, deck composition, deck contents.
   - User-identifying information of any kind.
   - Card-finder search strings (they could contain PII patterns).

   GA4 is configured with `anonymize_ip` and `IP Anonymization`
   enabled at the property level. No User-ID feature, no
   demographics, no remarketing audiences.

   Implementation: a tiny consent library
   (`vanilla-cookieconsent` or similar — < 5 kB gzipped). The
   library does **not** preload before consent is granted; it
   handles the banner UI only. GA4 is loaded via a dynamic
   `<script>` injection on Accept.

   The cookie banner is the only modal-ish element in the app. It
   uses `<dialog>` non-modally so it doesn't trap focus, has full
   keyboard support, and respects `prefers-reduced-motion`.
9. **Mobile-first vs. desktop-first layout.** *Decided: mobile-first.*

   The base layout targets a 360 px-wide viewport. Wider breakpoints
   add columns and density via progressive enhancement; they do not
   add or remove features.

   Layout breakpoints:
   - `< 600 px` — single column. Deck list on top, card finder
     opens as a bottom sheet overlay (`<dialog>`). Mana curve and
     Realism inline under the deck. Style picker collapses to a
     dropdown / chip group.
   - `600–1024 px` — single column gets generous, mana curve and
     Realism move into a sidebar at the right.
   - `≥ 1024 px` — two-column layout from the sketch earlier in
     this doc: deck list + chart on the left, card finder on the
     right.

   Other progressive-enhancement layers, all desktop-side:
   - Hover previews on card rows.
   - Keyboard shortcuts (`s` for Suggest, `a` for Auto-complete,
     `1`/`2`/`3` for Style).
   - Drag-to-reorder for personal-pref sorting (mobile sticks with
     a sort dropdown).

   Cards are not directly draggable on mobile because of the gesture
   conflicts with scrolling; mobile uses tap-to-add / tap-to-remove
   throughout. The "lock card" interaction from Q10 below has to be
   mobile-friendly first.
10. **Locking interaction.** *Decided: padlock icon per row, tap to
    toggle.*

    Every deck row has a small padlock affordance at a consistent
    position (right edge on desktop, leading edge on mobile so it's
    a comfortable thumb tap). State is visual:
    - Outline padlock → unlocked. Suggest/Auto-complete may remove
      this row's card.
    - Filled padlock → locked. Suggest/Auto-complete may never
      remove or replace this row; the row counts toward the 60-card
      total but is treated as fixed input.

    Tap target ≥ 44×44 px per the accessibility section. On desktop
    right-click on the row is a power-user shortcut for the same
    toggle. The "Clear" action shows a confirmation if any cards are
    locked, so a single tap doesn't lose a carefully-locked core.

    Locked state is persisted in `localStorage` alongside the rest
    of the deck state and is included in the URL-hash deck encoding
    so shared decks preserve which cards were considered "load-bearing".
