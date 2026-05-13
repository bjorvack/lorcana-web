import { test, expect } from "@playwright/test";

test.skip("happy path: pick inks, add cards, see legality status (TODO)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Lorcana/);
});
