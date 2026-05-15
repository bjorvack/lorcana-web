# lorcana-web

Vanilla-TypeScript Lorcana deck builder. Vite-bundled, deployed to GitHub
Pages, ONNX inference runs in a Web Worker so the card grid stays
responsive while the model is thinking.

Live: <https://bjorvack.github.io/lorcana-web/>

See [`DESIGN.md`](./DESIGN.md) for the full architecture.

## What it does

- Browse the full Lorcana card pool (filterable by ink, cost, type,
  rarity, format legality, …).
- Build a 60-card deck under live legality + max-copy rules from
  [`@bjorvack/lorcana-schemas`](https://github.com/bjorvack/lorcana-schemas).
- Get suggestions from the on-device model (proposal net + per-step
  evaluator) trained on real tournament decks by
  [`lorcana-training`](https://github.com/bjorvack/lorcana-training).
- Save / load / share decks via URL, no backend.

## Tech

- **Vite** + vanilla TypeScript. No framework — components are plain
  `class` constructors that mount into a parent `HTMLElement`.
- **ONNX Runtime Web** in a Web Worker for inference (model + tokenizer
  loaded lazily).
- **GA4** for anonymous usage analytics (`VITE_GA4_MEASUREMENT_ID` in
  `.env.production`).
- **`@bjorvack/lorcana-schemas`** as the only data-shape dependency —
  the same `Card` / `Deck` types validate inputs at runtime.

## Quick start

```bash
pnpm install
pnpm prefetch:cards   # pull the pinned cards-vN into ./public/data
pnpm prefetch:model   # pull the pinned model-vN ONNX bundle
pnpm dev              # vite dev server
```

Open <http://localhost:5173>.

## Project layout

```
src/
  components/  - UI primitives (CardGrid, DeckList, FilterBar, …)
  data/        - cards-vN loader + indexes, deck (de)serialisation
  model/       - tokenizer + ONNX session glue, proposal/evaluator API
  state/       - tiny pub-sub deck-state store (no framework)
  ui/          - top-level page assemblies
  worker/      - inference Web Worker (off-main-thread ORT)
  utils/       - misc helpers
build/
  run-fetch-cards.ts  - prefetch the latest cards-vN at build time
  run-fetch-model.ts  - prefetch the latest model-vN at build time
```

## CLIs

| Script | What it does |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Production bundle (output in `dist/`) |
| `pnpm preview` | Serve the production bundle locally |
| `pnpm prefetch:cards` | Download the pinned `cards-vN` artifact into `public/data` |
| `pnpm prefetch:model` | Download the pinned `model-vN` ONNX bundle into `public/model` |
| `pnpm test` | Vitest unit suite |
| `pnpm test:e2e` | Playwright e2e |

## Develop

See [`AGENTS.md`](./AGENTS.md) for the mandatory pre-commit checklist.

```bash
pnpm lint        # eslint + prettier --check
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # vite build (catches build-time errors lint/test miss)
```

## CI / Deploy

| Workflow | Trigger | Output |
|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | every push / PR | lint + typecheck + test |
| [`build.yml`](.github/workflows/build.yml) | push to `main` | production bundle deployed to GitHub Pages |
| [`new-cards-reminder.yml`](.github/workflows/new-cards-reminder.yml) | weekly cron | issue/comment when a new `cards-vN` is published upstream |

## Pinning data versions

`build/run-fetch-cards.ts` reads `package.json`'s
`lorcana_release_tags.cards` field to know which `cards-vN` to fetch;
`run-fetch-model.ts` does the same for `model`. Bumping a pin is a one-
line PR — the build step verifies the artifact downloads + parses
against the schema before deploy.
