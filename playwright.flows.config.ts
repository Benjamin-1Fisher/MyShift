import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "flows.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://localhost:3002",
    launchOptions: {
      executablePath: "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      command: "node e2e/database-server.mjs",
      url: "http://127.0.0.1:4001/health",
      timeout: 60000,
    },
    {
      command: "npm run dev -- --port 3002",
      url: "http://localhost:3002",
      timeout: 60000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4001",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public-key",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
