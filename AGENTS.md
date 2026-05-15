# AGENTS.md — lorcana-web

## Pre-commit checklist (run before every commit/push)

CI runs these exact commands. Skipping them locally means
shipping red commits to `main`. **Always run all four before
`git commit`:**

```bash
pnpm lint        # eslint . && prettier --check .
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # vite build (catches build-time errors lint/test miss)
```

If lint fails on formatting:

```bash
pnpm format      # prettier --write .
```

Then re-run `pnpm lint` to confirm.

## Why this matters

- `.github/workflows/ci.yml` and `build.yml` both run lint +
  typecheck + test + build. Any failing means a red commit on
  `main`.
- The build job publishes the production bundle — a broken
  build means broken deploys, not just a noisy badge.

## E2E (optional)

```bash
pnpm test:e2e    # playwright test
```

Run when touching routes, data fetching, or interactive UI.
