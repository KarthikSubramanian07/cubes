import { expect, test, type Page } from "@playwright/test";

/**
 * Placing pieces on the Night board must feel immediate: the click lands
 * exactly where the ghost is shown, even after the pointer has rested for a
 * while (the camera used to drift under a still cursor) or the bot has moved.
 */

async function findValid(page: Page): Promise<{ x: number; y: number } | null> {
  const box = (await page.locator(".g-board-wrap canvas").boundingBox())!;
  for (let gy = 0.15; gy < 0.9; gy += 0.035) {
    for (let gx = 0.12; gx < 0.88; gx += 0.035) {
      const x = box.x + box.width * gx;
      const y = box.y + box.height * gy;
      await page.mouse.move(x, y);
      await page.waitForTimeout(30);
      if ((await page.locator(".g-board-wrap").getAttribute("data-ghost-state")) === "valid") return { x, y };
    }
  }
  return null;
}

test("night board: a resting cursor still places where the ghost is", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.addInitScript(() => localStorage.setItem("cubes:board:v1", "night"));
  await page.goto("/game/local?preset=duel&seats=human,flare");
  await expect(page.locator(".game.night canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".g-turn-note")).toBeVisible({ timeout: 60_000 });

  for (let move = 1; move <= 3; move++) {
    await page.keyboard.press("1");
    const at = await findValid(page);
    expect(at, `move ${move}: a valid spot`).not.toBeNull();
    // Rest long enough that the old idle drift would have moved the board.
    await page.waitForTimeout(move === 1 ? 10_000 : 1_500);
    await expect(page.locator(".g-board-wrap")).toHaveAttribute("data-ghost-state", "valid");
    const before = await page.locator(".g-seat.me .g-seat-score").innerText();
    await page.mouse.click(at!.x, at!.y);
    await expect(page.locator(".g-seat.me .g-seat-score")).not.toHaveText(before, { timeout: 5_000 });
    // The bot answers and it's our turn again.
    await expect(page.locator(".g-turn-note")).toBeVisible({ timeout: 30_000 });
  }
  expect(errors).toEqual([]);
});
