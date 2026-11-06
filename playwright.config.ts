import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["workspace.spec.ts", "demo.spec.ts", "departments.spec.ts"],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    launchOptions: {
      executablePath: existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : undefined,
      args: ["--no-sandbox"],
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm start",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
        timeout: 60000,
      },
});
