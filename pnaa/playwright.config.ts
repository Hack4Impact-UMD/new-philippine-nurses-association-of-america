import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load environment variables from .env.local
dotenv.config({ path: ".env.local" });

/**
 * Playwright E2E Test Configuration
 *
 * All E2E tests run against the STAGING Firebase environment.
 * This ensures tests use real Firebase behavior without affecting production.
 *
 * Prerequisites:
 * 1. Ensure .env.staging.local exists with staging Firebase credentials
 * 2. Run: npm run test:e2e (starts app with staging env automatically)
 *
 * Test directories:
 * - e2e/local/  → Main E2E tests (chapters, events, fundraising, data tables)
 * - e2e/staging/ → Auth flow tests that need Wild Apricot OAuth
 */
export default defineConfig({
  // Where E2E test files live
  testDir: "./e2e",

  // Run tests in parallel for speed
  fullyParallel: true,

  // Fail CI if test.only() is left in code
  forbidOnly: !!process.env.CI,

  // Retry failed tests (more retries in CI where flakiness is more common)
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers in CI to avoid resource issues
  workers: process.env.CI ? 1 : undefined,

  // Generate HTML report
  reporter: "html",

  // Shared settings for all tests
  use: {
    // Base URL for page.goto("/dashboard") style navigation
    baseURL: "http://localhost:3000",

    // Capture trace on first retry (helps debug flaky tests)
    trace: "on-first-retry",

    // Screenshot on failure (helps debug what went wrong)
    screenshot: "only-on-failure",

    // Increase timeout for staging (network latency)
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  // Global test timeout (staging can be slower)
  timeout: 60000,

  // Browser configurations
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Mobile testing
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Start Next.js dev server with STAGING environment before running tests
  webServer: {
    // Use staging environment for all E2E tests
    command: "npm run dev:staging",
    url: "http://localhost:3000",
    // Reuse existing server if already running (faster local development)
    reuseExistingServer: !process.env.CI,
    // Wait up to 2 minutes for server to start
    timeout: 120 * 1000,
    // Environment variables for the web server
    env: {
      NODE_ENV: "test",
    },
  },
});
