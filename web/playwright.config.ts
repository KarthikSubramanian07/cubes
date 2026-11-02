import { defineConfig, devices } from "@playwright/test";

const PORT = 5181;

export default defineConfig({
  testDir: "./e2e",
  // Generous: audio rendering is CPU-bound and CI runners (or busy laptops) vary a lot.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/sound-lab.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
