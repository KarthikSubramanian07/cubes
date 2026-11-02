import { defineConfig, devices } from "@playwright/test";

// Override with PW_PORT when several checkouts test at once; a stale server on
// the same port would otherwise be reused and test the wrong build.
const PORT = Number(process.env.PW_PORT ?? 4179);

// One production build served by `vite preview` for every suite: the CSP
// check only means something against built assets, and the labs are build
// inputs too. Timeouts are generous: WebGL and audio rendering in a headless
// browser are CPU-bound, and CI runners vary a lot.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    // Phones and tablets in Safari's engine, with touch.
    { name: "webkit-devices", testMatch: /devices\.spec\.ts/, use: { browserName: "webkit" } },
    {
      name: "chromium",
      testIgnore: /devices\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        // Real GPU on macOS (Metal via ANGLE); software WebGL elsewhere (CI).
        launchOptions: {
          args:
            process.platform === "darwin"
              ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
              : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  webServer: {
    command: `bunx vite build && bunx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: process.env.PW_REUSE === "1",
    timeout: 240_000,
  },
});
