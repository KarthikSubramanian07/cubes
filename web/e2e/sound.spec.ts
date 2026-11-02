import { expect, test, type Page } from "@playwright/test";

type Lab = {
  sound: { stats(): { played: number; skipped: number; voices: number }; getSettings(): { state: string } };
  CUE_NAMES: readonly string[];
  DEFAULT_CUE_PARAMS: Record<string, unknown>;
  renderCue(name: string, params?: Record<string, unknown>): Promise<{ peak: number; rms: number } | null>;
};

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

const voices = (page: Page) => page.evaluate(() => (globalThis as unknown as { __soundLab: Lab }).__soundLab.sound.stats().voices);
const played = (page: Page) => page.evaluate(() => (globalThis as unknown as { __soundLab: Lab }).__soundLab.sound.stats().played);

test.describe("sound lab", () => {
  test("every cue button fires on a live context without errors", async ({ page }) => {
    const errors = watchErrors(page);
    // Skip waveform thumbnails here: this test is about the live context.
    await page.goto("/sound-lab.html?waves=0");
    await expect(page.getByTestId("ctx-state")).toHaveAttribute("data-state", "locked");

    // First gesture unlocks audio.
    await page.locator("h1").click();
    await expect(page.getByTestId("ctx-state")).toHaveAttribute("data-state", "running");

    const names = await page.evaluate(() => [...(globalThis as unknown as { __soundLab: Lab }).__soundLab.CUE_NAMES]);
    expect(names.length).toBe(25);
    for (const name of names) {
      const button = page.getByTestId(`cue-${name}`);
      await button.scrollIntoViewIfNeeded();
      // Let long tails drain so the voice cap can't legitimately drop this cue.
      await expect.poll(() => voices(page), { timeout: 10_000 }).toBeLessThan(60);
      const before = await played(page);
      await button.click();
      await expect.poll(() => played(page), { message: `cue ${name} played` }).toBeGreaterThan(before);
      // Respect per-cue rate limits between clicks.
      await page.waitForTimeout(60);
    }

    // Parameter controls feed the cues.
    await page.getByTestId("seat-2").click();
    await page.getByTestId("cue-place").click();
    await page.getByTestId("seat-3").click();
    await page.getByTestId("cue-dark").click();

    // Music bed on, push intensity, let the scheduler run, then off.
    const music = page.getByTestId("music");
    if ((await music.getAttribute("aria-checked")) !== "true") await music.click();
    await page.getByTestId("intensity").fill("0.9");
    await page.waitForTimeout(1500);
    await music.click();
    await expect(music).toHaveAttribute("aria-checked", "false");

    // Mute really silences: cues are skipped, not played.
    await page.getByTestId("mute").click();
    const mutedBefore = await played(page);
    await page.getByTestId("cue-win").click();
    await page.waitForTimeout(100);
    expect(await played(page)).toBe(mutedBefore);
    await page.getByTestId("mute").click();

    expect(errors).toEqual([]);
  });

  test("offline renders of every cue are audible and never clip", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/sound-lab.html?waves=0");
    const results = await page.evaluate(async () => {
      const lab = (globalThis as unknown as { __soundLab: Lab }).__soundLab;
      const out: { name: string; peak: number; rms: number }[] = [];
      for (const name of lab.CUE_NAMES) {
        const r = await lab.renderCue(name);
        out.push({ name, peak: r?.peak ?? -1, rms: r?.rms ?? -1 });
      }
      // Every seat, every size, with combo and hard pan: the loudest placements.
      for (let seat = 0; seat < 4; seat++)
        for (let size = 1; size <= 5; size++) {
          const r = await lab.renderCue("place", { ...lab.DEFAULT_CUE_PARAMS, seat, size, combo: 7, pan: seat % 2 ? 1 : -1 });
          out.push({ name: `place s${seat} n${size}`, peak: r?.peak ?? -1, rms: r?.rms ?? -1 });
        }
      return out;
    });
    for (const r of results) {
      expect(r.peak, `${r.name} is audible`).toBeGreaterThan(0.003);
      expect(r.peak, `${r.name} stays under 0 dBFS`).toBeLessThan(1);
      expect(Number.isFinite(r.rms), `${r.name} rms`).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test("screenshot of the board", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/sound-lab.html");
    await page.locator("h1").click();
    // Wait for every waveform to finish its offline render.
    await expect(page.locator(".peak", { hasText: "…" })).toHaveCount(0, { timeout: 90_000 });
    await page.getByTestId("seat-1").click();
    await page.getByTestId("cue-place").click();
    await expect(page.locator(".peak", { hasText: "…" })).toHaveCount(0, { timeout: 90_000 });
    await page.screenshot({ path: "test-results/sound-lab.png", fullPage: true });
  });
});
