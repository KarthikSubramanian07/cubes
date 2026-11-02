import { expect, test, type Page } from "@playwright/test";

/**
 * Two people, one link. Needs the rooms Worker on :8787
 * (`cd crates/rooms && npx wrangler dev`); skipped otherwise.
 */
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join("");

async function workerUp(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:8787/api/health");
    return r.ok;
  } catch {
    return false;
  }
}

async function placeSomething(page: Page): Promise<boolean> {
  await page.keyboard.press("1");
  const box = (await page.getByRole("application").first().boundingBox())!;
  for (let gy = 0.05; gy < 0.95; gy += 0.02) {
    for (let gx = 0.05; gx < 0.95; gx += 0.02) {
      await page.mouse.move(box.x + box.width * gx, box.y + box.height * gy);
      if (await page.evaluate(() => !!document.querySelector('[data-ghost="valid"]'))) {
        await page.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
        return true;
      }
    }
  }
  return false;
}

test("a host and a guest play over a link", async ({ browser }) => {
  test.skip(!(await workerUp()), "rooms Worker not running on :8787");
  const host = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const guest = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  for (const ctx of [host, guest]) await ctx.addInitScript(() => localStorage.setItem("cubes:board:v1", "paper"));
  const a = await host.newPage();
  const b = await guest.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(String(e)));

  await a.goto(`/r/${code}`);
  await expect(a.getByText("live")).toBeVisible({ timeout: 30_000 });
  await b.goto(`/r/${code}`);
  await expect(b.getByText("live")).toBeVisible({ timeout: 30_000 });

  // Both are seated automatically; the host starts.
  await expect(a.getByRole("button", { name: /start game/i })).toBeEnabled({ timeout: 20_000 });
  await a.screenshot({ path: "test-results/online-lobby.png", fullPage: true });
  await a.getByRole("button", { name: /start game/i }).click();

  await expect(a.locator(".game")).toBeVisible({ timeout: 30_000 });
  await expect(b.locator(".game")).toBeVisible({ timeout: 30_000 });

  // Seat 0 (the host) moves first.
  await expect(a.locator(".g-turn-note")).toBeVisible({ timeout: 30_000 });
  expect(await placeSomething(a)).toBe(true);

  // The guest sees the host's light arrive, then it's the guest's turn.
  await expect(b.locator(".g-seat").first().locator(".g-seat-score")).not.toHaveText("0", { timeout: 20_000 });
  await expect(b.locator(".g-turn-note")).toBeVisible({ timeout: 20_000 });
  expect(await placeSomething(b)).toBe(true);
  await expect(a.locator(".g-seat").nth(1).locator(".g-seat-score")).not.toHaveText("0", { timeout: 20_000 });

  // Chat makes it across.
  await b.getByRole("button", { name: /^chat/ }).click();
  await b.getByLabel("Chat message").fill("nice corner");
  await b.getByLabel("Chat message").press("Enter");
  await a.getByRole("button", { name: /^chat/ }).click();
  await expect(a.getByText("nice corner")).toBeVisible({ timeout: 10_000 });

  await a.screenshot({ path: "test-results/online-host.png" });
  await b.screenshot({ path: "test-results/online-guest.png" });
  expect(errors).toEqual([]);
  await host.close();
  await guest.close();
});
