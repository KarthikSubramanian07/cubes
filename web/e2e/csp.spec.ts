import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves every response with the production Content-Security-Policy from public/_headers
 * (vite preview doesn't apply _headers) and checks that no page trips it.
 */
const headers = readFileSync(join(import.meta.dirname, "..", "public", "_headers"), "utf8");
const csp = (/Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? "")
  // Local preview is plain http; upgrading would break every request.
  .replace(/;\s*upgrade-insecure-requests/, "")
  .trim();

test("CSP from _headers is strict and nothing violates it", async ({ page }) => {
  test.setTimeout(180_000);
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).toContain("worker-src 'self' blob:");

  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const h = { ...response.headers() };
    delete h["content-encoding"];
    delete h["content-length"];
    await route.fulfill({ status: response.status(), body: await response.body(), headers: { ...h, "content-security-policy": csp } });
  });
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  for (const path of ["/", "/rules", "/play", "/r/ABCDE", "/game/local", "/nope"]) {
    await page.goto(path);
    await expect(page.locator("#root")).not.toBeEmpty();
    await page.waitForTimeout(400);
  }
  expect(violations).toEqual([]);
});
