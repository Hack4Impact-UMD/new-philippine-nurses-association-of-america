/**
 * E2E Tests for Dashboard - Runs against STAGING Firebase
 *
 * Environment: Firebase Staging (pnaa-chaptermanagement-staging)
 * Config: Uses .env.staging.local via `npm run dev:staging`
 *
 * Tests the main dashboard functionality:
 * - Authentication redirects
 * - Page structure and UI elements
 * - Navigation flows
 *
 * Note: Full authenticated tests require a test user in staging.
 * See AUTH_SETUP.md for creating test users.
 */

import { test, expect } from "@playwright/test";

test.describe("Dashboard - Unauthenticated", () => {
  test("redirects to signin when not authenticated", async ({ page }) => {
    await page.goto("/dashboard");

    // Should redirect to signin page
    await expect(page).toHaveURL(/\/signin/);
  });

  test("signin page loads correctly", async ({ page }) => {
    await page.goto("/signin");

    // Should have a sign in button
    const signInButton = page.getByRole("button", { name: /sign in/i });
    await expect(signInButton).toBeVisible();
  });

  test("signin page has correct title", async ({ page }) => {
    await page.goto("/signin");

    // Check page has loaded with appropriate content
    await expect(page).toHaveTitle(/PNAA|Sign In|Philippine/i);
  });

  test("root page redirects to signin when unauthenticated", async ({
    page,
  }) => {
    await page.goto("/");

    // Should redirect to signin for unauthenticated users
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe("Protected Routes - Access Control", () => {
  const protectedRoutes = [
    { path: "/dashboard", name: "Dashboard" },
    { path: "/chapters", name: "Chapters" },
    { path: "/events", name: "Events" },
    { path: "/fundraising", name: "Fundraising" },
    { path: "/users", name: "Users" },
  ];

  for (const route of protectedRoutes) {
    test(`${route.name} (${route.path}) redirects to signin when unauthenticated`, async ({
      page,
    }) => {
      await page.goto(route.path);

      // All protected routes should redirect to signin
      await expect(page).toHaveURL(/\/signin/);
    });
  }
});

test.describe("Error Pages", () => {
  test("shows 404 for invalid routes", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-12345");

    // Should show 404 content (use specific selector to avoid matching multiple elements)
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});

test.describe("Sign In Page UI", () => {
  test("has Wild Apricot OAuth button", async ({ page }) => {
    await page.goto("/signin");

    // The sign in button should be present
    const signInButton = page.getByRole("button", { name: /sign in/i });
    await expect(signInButton).toBeVisible();
    await expect(signInButton).toBeEnabled();
  });

  test("sign in button initiates OAuth flow", async ({ page }) => {
    await page.goto("/signin");

    const signInButton = page.getByRole("button", { name: /sign in/i });
    await signInButton.click();

    // Should redirect to Wild Apricot OAuth (mypnaa.org is the custom domain)
    // Wait for navigation to happen
    await page.waitForURL((url) => {
      const href = url.href;
      return (
        href.includes("wildapricot") ||
        href.includes("mypnaa.org") ||
        href.includes("/api/auth/signin") ||
        href.includes("oauth")
      );
    }, { timeout: 10000 }).catch(() => {
      // If timeout, check current URL
    });

    const currentUrl = page.url();
    // Should have navigated away from /signin
    expect(
      currentUrl.includes("wildapricot") ||
        currentUrl.includes("mypnaa.org") ||
        currentUrl.includes("/api/auth") ||
        currentUrl.includes("oauth")
    ).toBeTruthy();
  });
});

test.describe("Responsive Design - Sign In", () => {
  test("signin page works on mobile", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto("/signin");

    const signInButton = page.getByRole("button", { name: /sign in/i });
    await expect(signInButton).toBeVisible();
    await expect(signInButton).toBeEnabled();
  });

  test("signin page works on tablet", async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto("/signin");

    const signInButton = page.getByRole("button", { name: /sign in/i });
    await expect(signInButton).toBeVisible();
  });
});
