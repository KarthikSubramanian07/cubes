import { expect, test } from "@playwright/test";

const cases = [
  { name: "plane-night", url: "/game/local?preset=plane&seats=flare,ember,flare,ember" },
  { name: "stack-night", url: "/game/local?preset=stack&seats=flare,ember" },
  { name: "orbit-night", url: "/game/local?preset=orbit&seats=flare,ember" },
  { name: "fog-night", url: "/game/local?preset=fog&seats=flare,ember" },
];

for (const c of cases) {
  test(`night board renders a live bot game: ${c.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(c.url);
    await expect(page.locator(".game.night canvas")).toBeVisible({ timeout: 60_000 });
    // Bots play on their own; catch the board mid-game.
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `test-results/${c.name}.png` });
    expect(errors).toEqual([]);
  });
}
