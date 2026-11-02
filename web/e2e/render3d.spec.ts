import { expect, test, type Page } from "@playwright/test";

const SCENES = ["plane", "fog", "stack", "orbit"] as const;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const OUT = process.env.SHOT_DIR ?? "test-results/render3d";

async function openLab(page: Page, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/lab.html?${query}`);
  await page.waitForFunction(() => window.__lab?.ready === true);
  await page.locator("canvas").first().waitFor();
  await page.waitForTimeout(2200); // shaders compile, camera settles
  return errors;
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.name === "mobile" ? 2 : 1 });

    for (const scene of SCENES) {
      test(`renders ${scene}`, async ({ page }) => {
        const errors = await openLab(page, `scene=${scene}&quality=high&ui=${vp.name === "mobile" ? 0 : 1}`);
        await page.screenshot({ path: `${OUT}/${scene}-${vp.name}.png` });
        expect(errors.filter((e) => !/Download the React DevTools/.test(e))).toEqual([]);
      });
    }
  });
}

test.describe("juice", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("placement, shatter, storm and misfire animate without errors", async ({ page }) => {
    const errors = await openLab(page, "scene=plane&quality=high&ui=0");
    await page.evaluate(() => window.__lab!.place());
    await page.waitForTimeout(330);
    await page.screenshot({ path: `${OUT}/juice-place.png` });
    await page.evaluate(() => window.__lab!.shatter());
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${OUT}/juice-shatter.png` });
    await page.evaluate(() => window.__lab!.storm());
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/juice-storm.png` });
    await page.evaluate(() => window.__lab!.misfire());
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/juice-misfire.png` });
    await page.evaluate(() => window.__lab!.node());
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/juice-node.png` });
    expect(errors).toEqual([]);
  });

  test("hovering shows a ghost, clicking places it, dragging does not", async ({ page }) => {
    await openLab(page, "scene=stack&quality=medium&ui=1");
    const box = (await page.locator("canvas").first().boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.62);
    await page.waitForTimeout(250);
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.64);
    await page.waitForTimeout(400);
    await expect(page.locator(".lab-foot")).not.toContainText("hover none");
    await page.screenshot({ path: `${OUT}/ghost-stack.png` });
    // Walk the pointer until the ghost is valid, then a click (no drag) places it and advances the ply.
    const ply = page.locator(".lab-turn .lab-eyebrow");
    const before = await ply.textContent();
    for (let i = 0; i < 40 && (await ply.textContent()) === before; i++) {
      const x = box.x + box.width * (0.42 + (i % 8) * 0.03);
      const y = box.y + box.height * (0.5 + Math.floor(i / 8) * 0.05);
      await page.mouse.move(x, y);
      await page.waitForTimeout(120);
      await page.mouse.click(x, y);
      await page.waitForTimeout(120);
    }
    await expect(ply).not.toHaveText(before ?? "");
    // A drag orbits the camera and must not place anything.
    const afterClick = await ply.textContent();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.52, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(ply).toHaveText(afterClick ?? "");
  });

  for (const scene of SCENES) {
    test(`frame rate ${scene}`, async ({ page }) => {
      await openLab(page, `scene=${scene}&quality=high&ui=0`);
      const fps = await page.evaluate(() => window.__lab!.measureFps(3000));
      console.log(`FPS ${scene} high 1440x900: ${fps.toFixed(1)}`);
      expect(fps).toBeGreaterThan(5);
    });
  }
});
