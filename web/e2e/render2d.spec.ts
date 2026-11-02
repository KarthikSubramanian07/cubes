import { expect, test, type Page } from "@playwright/test";

const SCENES = ["plane", "fog", "octagon", "torus"] as const;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

async function open(page: Page, scene: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/paper-lab.html?scene=${scene}&motion=reduce`);
  const board = page.getByTestId("paper-board");
  await expect(board.locator("svg")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { board, errors };
}

/** Centre of cell (x, y) in page coordinates, from the board's own geometry. */
async function cellPoint(page: Page, x: number, y: number, size = 20) {
  const box = (await page.getByTestId("paper-board").locator("svg").boundingBox())!;
  const span = size + 2.3; // cells plus the 1.15-cell margin each side
  const s = Math.min(box.width, box.height) / span;
  const ox = box.x + (box.width - s * span) / 2 + s * 1.15;
  const oy = box.y + (box.height - s * span) / 2 + s * 1.15;
  return { x: ox + (x + 0.5) * s, y: oy + (y + 0.5) * s };
}

for (const vp of VIEWPORTS) {
  test.describe(`paper lab at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });

    for (const scene of SCENES) {
      test(`${scene} scene draws cleanly`, async ({ page }, info) => {
        const { board, errors } = await open(page, scene);
        // Shards, cores and the inked border are all there.
        expect(await board.locator("svg path").count()).toBeGreaterThan(50);
        await expect(board.locator("text", { hasText: /^C$/ })).toHaveCount(1);
        if (scene === "fog") await expect(board.locator("text", { hasText: "?" }).first()).toBeVisible();
        if (scene === "torus") await expect(board.locator("text", { hasText: "edges wrap" })).toBeVisible();
        const box = (await board.boundingBox())!;
        expect(box.width).toBeLessThanOrEqual(vp.width);
        const shot = await page.screenshot({ fullPage: true });
        await info.attach(`${scene}-${vp.name}`, { body: shot, contentType: "image/png" });
        await page.screenshot({ path: info.outputPath(`${scene}-${vp.name}.png`), fullPage: true });
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe("interaction", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hover shows a ghost, a click places it and marks it new", async ({ page }) => {
    await open(page, "plane");
    await page.getByTestId("paper-board").scrollIntoViewIfNeeded();
    let placed = false;
    for (let y = 1; y < 19 && !placed; y++) {
      for (let x = 1; x < 19 && !placed; x++) {
        const p = await cellPoint(page, x, y);
        await page.mouse.move(p.x, p.y);
        if ((await page.locator("[data-ghost=valid]").count()) === 0) continue;
        await page.mouse.click(p.x, p.y);
        placed = true;
      }
    }
    expect(placed).toBe(true);
    await expect(page.locator(".lab-log")).toContainText("placed");
    await expect(page.getByTestId("paper-board").getByText("new!")).toBeVisible();
  });

  test("an illegal spot shows the red scribble", async ({ page }) => {
    await open(page, "plane");
    await page.getByTestId("paper-board").scrollIntoViewIfNeeded();
    // The middle of the board is crowded: somewhere there is a spot that doesn't fit.
    let seen = false;
    for (let x = 6; x < 14 && !seen; x++) {
      const p = await cellPoint(page, x, 10);
      await page.mouse.move(p.x, p.y);
      seen = (await page.locator("[data-ghost=invalid]").count()) > 0;
    }
    expect(seen).toBe(true);
  });

  test("keyboard: arrows move the cursor and are announced", async ({ page }) => {
    await open(page, "plane");
    const board = page.getByTestId("paper-board");
    await board.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const live = board.locator("[aria-live]");
    await expect(live).toHaveText(/^[A-T]\d{1,2}, /);
    const before = await live.textContent();
    await page.keyboard.press("ArrowLeft");
    await expect(live).not.toHaveText(before!);
    await page.keyboard.press("Enter");
    await expect(page.locator(".lab-log")).not.toHaveText("A fresh page.");
  });

  test("simulated moves bleed in with motion on", async ({ page }) => {
    await page.goto("/paper-lab.html?scene=octagon");
    await expect(page.getByTestId("paper-board").locator("svg")).toBeVisible();
    await page.getByRole("button", { name: "next move" }).click();
    await expect(page.locator(".pb-bleed")).toHaveCount(1);
  });
});
