import { devices, expect, test, type Page } from "@playwright/test";

/**
 * Phones and tablets, in WebKit (Safari's engine) with real touch input:
 * no page may scroll sideways, and a shard must be placeable by tapping
 * (tap to preview, tap again to place) on both boards.
 * Most reliable against a preview you start yourself:
 *   bunx vite build && bunx vite preview --port 4311 --host 127.0.0.1 &
 *   PW_REUSE=1 PW_PORT=4311 bunx playwright test --project=webkit-devices --workers=1
 */
const PROFILES = {
  "iPhone SE": devices["iPhone SE"],
  "iPhone 15": devices["iPhone 15"],
  "iPad portrait": devices["iPad Pro 11"],
  "iPad landscape": devices["iPad Pro 11 landscape"],
} as const;

async function sideways(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const [name, profile] of Object.entries(PROFILES)) {
  test.describe(name, () => {
    // The project picks the browser (WebKit); take everything else from the profile.
    const { defaultBrowserType: _browser, ...device } = profile;
    test.use(device);

    for (const path of ["/", "/play", "/rules", "/learn", "/nope"]) {
      test(`${path} fits the screen`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });
        await page.waitForTimeout(800);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    }

    for (const board of ["night", "paper"] as const) {
      test(`a shard can be placed by touch on the ${board} board`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.addInitScript((b) => localStorage.setItem("cubes:board:v1", b), board);
        await page.goto("/game/local?preset=duel&seats=human,flare");
        await expect(page.locator(".g-turn-note")).toBeVisible({ timeout: 60_000 });
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        await page.locator(".g-shard").first().tap();
        const area = (await page.locator(".g-board-wrap").boundingBox())!;
        let placed = false;
        sweep: for (let gy = 0.08; gy < 0.92; gy += 0.035) {
          for (let gx = 0.06; gx < 0.94; gx += 0.035) {
            const x = area.x + area.width * gx;
            const y = area.y + area.height * gy;
            await page.touchscreen.tap(x, y);
            if (/tap again/.test(await page.locator(".g-turn-note").innerText().catch(() => ""))) {
              await page.touchscreen.tap(x, y);
              placed = true;
              break sweep;
            }
          }
        }
        expect(placed).toBe(true);
        await expect(page.locator(".g-seat-score").first()).not.toHaveText("0");
        expect(errors).toEqual([]);
      });
    }
  });
}
