import { expect, test, type Page } from "@playwright/test";

/**
 * Visual pass over every shell route at desktop and phone widths, in both themes.
 * Screenshots land in e2e/screenshots/ (gitignored) for a human (or a picky agent) to look at.
 */

const ROUTES = [
  { name: "landing", path: "/" },
  { name: "rules", path: "/rules" },
  { name: "play", path: "/play" },
  { name: "room", path: "/r/ABCDE" },
  { name: "game", path: "/game/local" },
  { name: "404", path: "/definitely-not-a-page" },
];

const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const THEMES = ["light", "dark"] as const;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

for (const theme of THEMES) {
  for (const vp of WIDTHS) {
    for (const route of ROUTES) {
      test(`${route.name} · ${vp.name} · ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // Reduced motion renders every doodle and reveal in its final state, so shots are deterministic.
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
        await page.goto(route.path);
        await expect(page.locator("#root")).not.toBeEmpty();
        await settle(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(0);
        await page.screenshot({ path: `e2e/screenshots/${route.name}-${vp.name}-${theme}.png`, fullPage: true });
        expect(errors, "no console errors").toEqual([]);
      });
    }
  }
}

test("motion: hero plays and sections reveal on scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const cells = page.locator(".hero .hb__cell");
  await expect.poll(() => cells.count(), { timeout: 15_000 }).toBeGreaterThan(4);
  const firstStep = page.locator(".how__step").first();
  await expect(firstStep).toHaveAttribute("data-inview", "false");
  await firstStep.scrollIntoViewIfNeeded();
  await expect(firstStep).toHaveAttribute("data-inview", "true");
  expect(errors).toEqual([]);
});
