/**
 * Standalone entry point for the fetch-model plugin so CI (and
 * humans on a fresh checkout) can materialise ``public/model/*`` +
 * ``src/data/model.meta.ts`` *before* running typecheck / lint /
 * tests.
 *
 * Mirrors ``run-fetch-cards.ts``. When ``MODEL_RELEASE_TAG`` in
 * ``src/version.ts`` is ``null``, the plugin no-ops and this script
 * exits cleanly — keeps the script usable during the brief window
 * after a cards bump but before the matching model retrain ships.
 *
 *   pnpm prefetch:model
 */

import { fetchModel } from "./fetch-model";

const plugin = fetchModel();

const fakeCtx = {
  info(msg: string): void {
    process.stdout.write(`${msg}\n`);
  },
};

const hook = plugin.buildStart;
if (typeof hook !== "function") {
  throw new Error("fetchModel plugin is missing buildStart");
}

await (hook as unknown as (this: typeof fakeCtx, opts: unknown) => Promise<void>).call(fakeCtx, {
  plugins: [],
});
