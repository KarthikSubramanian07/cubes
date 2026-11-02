import { expect, test, type Page } from "@playwright/test";

/**
 * Plays "First light" end to end through the real UI: for each chapter it
 * asks the page's solver for the intended move (found from the engine's
 * legal placements), then picks the shard in the tray, turns it with the
 * keyboard, aims at the right cell and clicks, exactly like a person would.
 * The 3D chapter submits through the same controller path instead of
 * clicking into WebGL. Screenshots every chapter before and after.
 */

type Vec3 = [number, number, number];
type Action =
  | { type: "place"; piece: number; orient: number; at: Vec3; leap: boolean }
  | { type: "shatter"; cell: number }
  | { type: "scan" };

interface LearnHook {
  chapter: string;
  step: number;
  complete: boolean;
  canAct: boolean;
}

const CHAPTERS = ["core", "corners", "block", "surges", "shatter", "fog", "stack", "graduate"];

async function hook(page: Page): Promise<LearnHook> {
  return page.evaluate(() => {
    const h = (window as unknown as { __learn: LearnHook }).__learn;
    return { chapter: h.chapter, step: h.step, complete: h.complete, canAct: h.canAct };
  });
}

async function waitFor(page: Page, pred: (h: LearnHook) => boolean, what: string, timeout = 30_000): Promise<LearnHook> {
  const end = Date.now() + timeout;
  for (;;) {
    const h = await hook(page).catch(() => null);
    if (h && pred(h)) return h;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(h)}`);
    await page.waitForTimeout(120);
  }
}

async function perform(page: Page, action: Action, night: boolean): Promise<void> {
  const learn = (fn: string, ...args: unknown[]) =>
    page.evaluate(([f, a]) => (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>).__learn![f as string]!(...(a as unknown[])), [fn, args] as const);

  if (night) {
    expect(await learn("act", action)).toBe(true);
    return;
  }
  await page.locator(".ln-stage").scrollIntoViewIfNeeded();
  if (action.type === "scan") {
    await page.locator('[data-surge="scan"]').click();
    return;
  }
  if (action.type === "shatter") {
    await page.locator('[data-surge="shatter"]').click();
    const pt = (await learn("point", action.cell)) as { x: number; y: number };
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.click(pt.x, pt.y);
    return;
  }
  const spark = await page.locator(`[data-piece="${action.piece}"]`).count() === 0;
  if (spark) await page.locator('[data-surge="spark"]').click();
  else await page.locator(`[data-piece="${action.piece}"]`).click();
  if (action.leap) await page.locator('[data-surge="leap"]').click();
  const keys = (await learn("keysFor", action.piece, action.orient)) as string[];
  for (const k of keys) await page.keyboard.press(k);
  const cell = (await learn("aimCell", action.piece, action.orient, action.at)) as number;
  const pt = (await learn("point", cell)) as { x: number; y: number };
  await page.mouse.move(pt.x - 3, pt.y - 3);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(60);
  await page.mouse.click(pt.x, pt.y);
}

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`plays every chapter of First light at ${w}x${h}`, async ({ page }) => {
    test.setTimeout(420_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("learn-e2e")) {
        sessionStorage.setItem("learn-e2e", "1");
        localStorage.removeItem("cubes:learn:v1");
      }
    });
    await page.goto("/learn");
    await expect(page.locator("article.ln-chapter")).toBeVisible({ timeout: 60_000 });

    for (const [n, id] of CHAPTERS.entries()) {
      await expect(page.locator(`article[data-chapter="${id}"]`)).toBeVisible({ timeout: 30_000 });
      await waitFor(page, (x) => x.chapter === id && x.canAct, `chapter ${id} to start`);
      const night = id === "stack";
      if (night) {
        await expect(page.locator(".ln-stage canvas")).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(2500);
      }
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `test-results/tutorial-${n + 1}-${id}-${w}.png` });

      for (let moves = 0; moves < 40; moves++) {
        const now = await waitFor(page, (x) => x.complete || x.canAct, `${id} to be playable`);
        if (now.complete) break;
        const action = (await page.evaluate(() => (window as unknown as { __learn: { solve(): unknown } }).__learn.solve())) as Action | null;
        expect(action, `a move for ${id} step ${now.step}`).not.toBeNull();
        const before = await page.evaluate(() => document.querySelector("article.ln-chapter")?.textContent ?? "");
        await perform(page, action!, night);
        // The move landed when the learner's turn passes, a step ticks, or the chapter completes.
        await waitFor(page, (x) => x.complete || x.step !== now.step || !x.canAct || x.chapter !== id, `${id} to accept the move`, 10_000).catch(async () => {
          const after = await page.evaluate(() => document.querySelector("article.ln-chapter")?.textContent ?? "");
          if (after === before) throw new Error(`move in ${id} didn't register`);
        });
        if (id === "fog" && now.step === 0) {
          await page.waitForTimeout(1600);
          await page.screenshot({ path: `test-results/tutorial-${n + 1}-${id}-misfire-${w}.png` });
        }
      }
      await expect(page.locator(`article[data-chapter="${id}"][data-complete]`)).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `test-results/tutorial-${n + 1}-${id}-done-${w}.png` });
      if (n < CHAPTERS.length - 1) await page.getByRole("button", { name: "Next chapter" }).click();
    }

    await expect(page.locator(".ln-grad").getByRole("link", { name: "Play a real game" })).toBeVisible();
    await expect(page.locator(".ln-grad").getByRole("link", { name: "Make a room" })).toBeVisible();
    // Every chapter is ticked off in the dots, and that sticks across a reload.
    await expect(page.locator(".learn__dot.is-done")).toHaveCount(CHAPTERS.length);
    await page.reload();
    await expect(page.locator(".learn__dot.is-done")).toHaveCount(CHAPTERS.length, { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
}

test("explains a wrong placement in the margin", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.removeItem("cubes:learn:v1"));
  await page.goto("/learn");
  await waitFor(page, (x) => x.chapter === "core" && x.canAct, "chapter one");
  await page.waitForTimeout(800);
  // The Elbow, flat against the Core's right side.
  await page.locator(".ln-tray [data-piece]").last().click();
  const pt = (await page.evaluate(() => {
    const l = (window as unknown as { __learn: { point(c: number): { x: number; y: number } } }).__learn;
    return l.point(4 + 8 * 4);
  })) as { x: number; y: number };
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator(".ln-note--error")).toContainText(/corners only|never|corner/);
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-results/tutorial-explain-1440.png" });
});

test("links in from the landing page, the play hub and the game's help sheet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Learn in three minutes" }).first().click();
  await expect(page).toHaveURL(/\/learn$/);
  await page.goto("/play");
  await expect(page.getByRole("link", { name: "Learn in three minutes" })).toBeVisible();
  await page.addInitScript(() => localStorage.setItem("cubes:board:v1", "paper"));
  await page.goto("/game/local?preset=duel&seats=human,flare");
  await page.getByRole("button", { name: "Controls and rules" }).click();
  await expect(page.getByRole("link", { name: "Take the three-minute lesson" })).toHaveAttribute("href", "/learn");
});
