import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30000,
  workers: 2,
  // Phones use the tabs; desktop tests set a wide viewport themselves.
  use: { baseURL: "http://127.0.0.1:3107", viewport: { width: 390, height: 844 } },
  webServer: {
    command: "npm run dev -- --port 3107",
    url: "http://127.0.0.1:3107/login",
    reuseExistingServer: false,
    timeout: 120000,
    env: { RECONTEI_E2E: "1" },
  },
});
