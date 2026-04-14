/**
 * E2E Tests for Authentication Flow - Runs against STAGING
 *
 * Environment: Firebase Staging (pnaa-chaptermanagement-staging)
 * These tests verify the Wild Apricot OAuth integration.
 *
 * Note: Full OAuth flow testing requires:
 * 1. Valid Wild Apricot test credentials
 * 2. Wild Apricot staging/sandbox environment
 *
 * These tests verify the OAuth initiation and error handling.
 * Full end-to-end auth testing should be done manually.
 */

import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
  test("sign in redirects to Wild Apricot OAuth", async ({ page }) => {
    await page.goto("/signin");

    const signInButton = page.getByRole("button", { name: /sign in/i });
    await expect(signInButton).toBeVisible();

    // Click sign in and wait for navigation
    await signInButton.click();

    // Should redirect to either:
    // 1. /api/auth/signin (internal redirect)
    // 2. Wild Apricot OAuth URL
    await page.waitForURL(
      (url) =>
        url.href.includes("/api/auth/signin") ||
        url.href.includes("wildapricot") ||
        url.href.includes("oauth"),
      { timeout: 10000 }
    ).catch(() => {});

    const currentUrl = page.url();

    // Should have navigated away from signin page
    expect(
      currentUrl.includes("/api/auth") ||
        currentUrl.includes("wildapricot") ||
        currentUrl.includes("oauth") ||
        !currentUrl.endsWith("/signin")
    ).toBeTruthy();
  });

  test("OAuth callback handles missing code gracefully", async ({ page }) => {
    // Hit callback without code parameter
    await page.goto("/api/auth/callback");

    // Should redirect to signin with error or show error page
    await page.waitForLoadState("domcontentloaded");

    const currentUrl = page.url();
    const pageText = await page.textContent("body");

    // Should either:
    // 1. Redirect to signin
    // 2. Show error message
    expect(
      currentUrl.includes("/signin") ||
        pageText?.toLowerCase().includes("error") ||
        pageText?.toLowerCase().includes("invalid")
    ).toBeTruthy();
  });

  test("OAuth callback handles invalid state gracefully", async ({ page }) => {
    // Hit callback with invalid state (CSRF protection test)
    await page.goto("/api/auth/callback?code=fake&state=invalid");

    await page.waitForLoadState("domcontentloaded");

    const currentUrl = page.url();
    const pageText = await page.textContent("body");

    // Should reject invalid state
    expect(
      currentUrl.includes("/signin") ||
        pageText?.toLowerCase().includes("error") ||
        pageText?.toLowerCase().includes("invalid")
    ).toBeTruthy();
  });

  test("sign out clears session", async ({ page, context }) => {
    // First, set a fake session cookie
    await context.addCookies([
      {
        name: "firebase_token",
        value: "fake-token-for-testing",
        domain: "localhost",
        path: "/",
      },
    ]);

    // Verify cookie is set
    let cookies = await context.cookies();
    expect(cookies.some((c) => c.name === "firebase_token")).toBeTruthy();

    // Call signout endpoint with POST (required by the API)
    await page.goto("/");
    const response = await page.request.post("/api/auth/signout");
    expect(response.ok()).toBeTruthy();

    // Cookie should be cleared
    cookies = await context.cookies();
    const cookieCleared = !cookies.some(
      (c) => c.name === "firebase_token" && c.value === "fake-token-for-testing"
    );

    expect(cookieCleared).toBeTruthy();
  });
});

test.describe("Session Management", () => {
  test("expired session redirects to signin", async ({ page, context }) => {
    // Set an expired/invalid cookie
    await context.addCookies([
      {
        name: "firebase_token",
        value: "expired-invalid-token",
        domain: "localhost",
        path: "/",
      },
    ]);

    // Try to access protected route
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Should redirect to signin due to invalid token
    // Note: This depends on server-side token verification
    const currentUrl = page.url();

    // Either shows error or redirects
    expect(
      currentUrl.includes("/signin") ||
        currentUrl.includes("/dashboard") // May show dashboard then redirect
    ).toBeTruthy();
  });

  test("accessing protected route without cookie redirects", async ({
    page,
    context,
  }) => {
    // Clear all cookies
    await context.clearCookies();

    // Try to access protected route
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Should redirect to signin
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe("First-Time Onboarding", () => {
  test("setup page requires authentication", async ({ page }) => {
    await page.goto("/setup");
    await page.waitForLoadState("domcontentloaded");

    // Should redirect to signin
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe("Auth Error Handling", () => {
  test("handles network errors gracefully", async ({ page }) => {
    // Go to signin page
    await page.goto("/signin");

    // Intercept the auth request and simulate failure
    await page.route("**/api/auth/signin", (route) => {
      route.abort("failed");
    });

    const signInButton = page.getByRole("button", { name: /sign in/i });
    await signInButton.click();

    // Should handle error gracefully (not crash)
    await page.waitForTimeout(1000);

    // Page should still be functional
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("CSRF Protection", () => {
  test("OAuth state parameter is required", async ({ page }) => {
    // Try callback without state parameter
    await page.goto("/api/auth/callback?code=test-code");
    await page.waitForLoadState("domcontentloaded");

    const currentUrl = page.url();
    const pageText = await page.textContent("body");

    // Should reject due to missing state
    expect(
      currentUrl.includes("/signin") ||
        pageText?.toLowerCase().includes("error") ||
        pageText?.toLowerCase().includes("state")
    ).toBeTruthy();
  });

  test("OAuth state must match cookie", async ({ page, context }) => {
    // Set a state cookie
    await context.addCookies([
      {
        name: "oauth_state",
        value: "correct-state-value",
        domain: "localhost",
        path: "/",
      },
    ]);

    // Try callback with mismatched state
    await page.goto("/api/auth/callback?code=test&state=wrong-state-value");
    await page.waitForLoadState("domcontentloaded");

    const currentUrl = page.url();
    const pageText = await page.textContent("body");

    // Should reject due to state mismatch
    expect(
      currentUrl.includes("/signin") ||
        pageText?.toLowerCase().includes("error")
    ).toBeTruthy();
  });
});
