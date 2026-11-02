import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 360000,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3100", acceptDownloads: true, trace: "retain-on-failure" },
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  ],
  webServer: {
    command: process.env.AIW_TEST_PRODUCTION === "1"
      ? "npm run start -w @aiw/web -- --hostname 127.0.0.1 --port 3100"
      : "npm run dev -w @aiw/web -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/studio",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      APP_ACCESS_PASSWORD: "test-password-at-least-sixteen", SESSION_SIGNING_SECRET: "test-signing-secret-at-least-thirty-two-characters",
      ...(process.env.RUN_LIVE_MOTION_TESTS === "1" ? {} : { HF_TOKEN: "" }),
      FAL_KEY: "", HIGGSFIELD_API_KEY: "", ENABLE_PAID_MOTION: "false", PAID_MOTION_BUDGET_REVIEWED: "false",
      CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "",
    },
  },
});
