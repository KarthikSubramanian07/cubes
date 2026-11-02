import { expect, test } from "@playwright/test";

test.describe("local game", () => {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`plays a move against a bot at ${w}x${h}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setViewportSize({ width: w, height: h });
      // This test drives the Paper board's SVG; the Night board has its own lab tests.
      await page.addInitScript(() => localStorage.setItem("cubes:board:v1", "paper"));
      await page.goto("/game/local?preset=duel&seats=human,flare");
      await expect(page.locator(".g-turn-note")).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: `test-results/game-start-${w}.png` });
      // Pick the biggest shard and use keyboard placement via the board.
      await page.keyboard.press("1");
      const board = page.getByRole("application").first();
      const box = (await board.boundingBox())!;
      // Sweep the board until a valid ghost appears, then click.
      let placed = false;
      for (let gy = 0.05; gy < 0.95 && !placed; gy += 0.02) {
        for (let gx = 0.05; gx < 0.95 && !placed; gx += 0.02) {
          await page.mouse.move(box.x + box.width * gx, box.y + box.height * gy);
          const valid = await page.evaluate(() => !!document.querySelector('[data-ghost="valid"], .ghost-valid'));
          if (valid) {
            await page.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
            placed = true;
          }
        }
      }
      expect(placed).toBe(true);
      // The bot answers and it's our move again.
      await expect(page.locator(".g-seat.me .g-seat-score")).not.toHaveText("0");
      await expect(page.locator(".g-turn-note")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `test-results/game-after-${w}.png` });
      expect(errors).toEqual([]);
    });
  }
});
