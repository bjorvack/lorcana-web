/**
 * End-to-end smoke test for the AI Generate flow.
 *
 * The intent is to catch regressions in the full stack that unit
 * tests can't reach: build-time model fetch → runtime bundle load →
 * worker spawn → ORT session init → 60-step search → deck-state
 * apply. Every check past "page loads" exercises one of those layers.
 *
 * The test relies on Amber + Steel being the default ink selection
 * the page boots with (see ``state/deck.ts``'s ``emptyDeck``) so it
 * doesn't have to click chips. Bumping the default inks should keep
 * this test green as long as the chosen pair survives in the model's
 * play-frequency table; if not, the seed-card lookup falls back to
 * ``_all`` and the test still works.
 */
import { expect, test } from "@playwright/test";

test("Generate fills the deck to 60/60", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Lorcana/);

  const deckCount = page.locator('[data-role="deck-count"]');
  await expect(deckCount).toHaveText("0 / 60");

  await page.locator('[data-role="generate"]').click();

  // The button label flips while the worker initialises + generates.
  // The exact label doesn't matter, but it should land on "Done"
  // within the run-loop timeout (90s). On CI the first ORT load
  // adds ~20s on top of the search, so generous timeouts here are
  // proportionate to the work, not slop.
  await expect(page.locator('[data-role="status"]')).toHaveText(/Done\./, {
    timeout: 2 * 60 * 1000,
  });

  // Deck reaches the target. Lorcana decks can carry more than 60
  // (DESIGN.md: "at least 60"), but our search loop stops at
  // targetSize=60, so an exact match is the meaningful assertion.
  await expect(deckCount).toHaveText("60 / 60");

  // Realism between 0 and 100, sanity-only. The number depends on
  // the model run; we just check the pill rendered something
  // plausible rather than NaN%.
  const status = await page.locator('[data-role="status"]').textContent();
  const match = /Realism (\d+)%/.exec(status ?? "");
  expect(match, "expected status to include a realism %").not.toBeNull();
  if (match) {
    const realism = Number(match[1]);
    expect(realism).toBeGreaterThanOrEqual(0);
    expect(realism).toBeLessThanOrEqual(100);
  }
});
