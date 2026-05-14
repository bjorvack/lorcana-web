/**
 * Playwright config for the one E2E we ship.
 *
 * The test exists primarily to keep AI generation from silently
 * regressing — the Generate button has a long invisible tail of
 * (build-time fetch + worker spawn + ORT WASM load + 60-step
 * search) that's easy to break without anyone noticing until a user
 * clicks it. The test exercises the whole chain against the real
 * model bundle that ``pnpm prefetch:model`` already wrote into
 * ``public/model/`` on this same CI run.
 *
 * We don't run a server here — ``pnpm test:e2e`` is expected to
 * point at an already-running ``pnpm dev`` (locally) or ``pnpm
 * preview`` (CI). That lets the dev/preview script live in the
 * workflow alongside any other diagnostics without Playwright
 * trying to manage its lifecycle.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Single project, single worker — we have one test and it talks to
  // a shared running server. Parallelism would just race them on
  // dev-server output.
  fullyParallel: false,
  workers: 1,
  // The generate flow downloads ~30 MB the first time and runs ~60
  // proposal/evaluator forwards in sequence. 3 minutes is comfortably
  // above the worst case we observed locally (~50s) without making
  // CI hang forever if something genuinely deadlocks.
  timeout: 3 * 60 * 1000,
  expect: { timeout: 90 * 1000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Local default: spin up the dev server. CI overrides
        // E2E_BASE_URL to the preview port instead.
        command: "pnpm dev",
        url: "http://localhost:5173/",
        timeout: 60 * 1000,
        reuseExistingServer: true,
      },
});
