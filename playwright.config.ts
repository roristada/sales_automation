import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// A non-zero render price so the spending-cap test can trigger; shared by the app server and
// the render worker the tests spawn.
process.env.RENDER_COST_THB_PER_VIDEO_SECOND ??= "0.05";

/** E2E tests run against `next start` + LOCAL Supabase. Run `npm run build` and `npm run db:start` first. */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", locale: "th-TH" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
