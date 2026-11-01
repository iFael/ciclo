import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    command: "npm run dev -- --port 3000",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: false,
    timeout: 120000,
    env: { CICLO_E2E: "1" },
  },
});
