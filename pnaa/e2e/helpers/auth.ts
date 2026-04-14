/**
 * Authentication Helpers for E2E Tests
 *
 * These helpers manage authentication state for Playwright tests
 * running against the STAGING Firebase environment.
 *
 * Setup Instructions:
 * 1. Create a test user in staging via Wild Apricot
 * 2. Set environment variables:
 *    - TEST_USER_EMAIL: Test user's email
 *    - TEST_USER_PASSWORD: Test user's password (if using direct auth)
 *    - Or use a pre-authenticated session cookie
 *
 * Usage in tests:
 * ```typescript
 * import { authenticateUser, AUTH_STORAGE_STATE } from '../helpers/auth';
 *
 * test.beforeEach(async ({ page }) => {
 *   await authenticateUser(page, 'national_admin');
 * });
 * ```
 */

import { Page, BrowserContext } from "@playwright/test";

// Path to store authenticated session state
export const AUTH_STORAGE_STATE = "e2e/.auth/user.json";

// Test user credentials (set via environment variables)
export const TEST_USERS = {
  national_admin: {
    email: process.env.TEST_NATIONAL_ADMIN_EMAIL || "",
    // For manual testing, you can set a session cookie directly
  },
  chapter_admin: {
    email: process.env.TEST_CHAPTER_ADMIN_EMAIL || "",
  },
  member: {
    email: process.env.TEST_MEMBER_EMAIL || "",
  },
};

/**
 * Check if authentication credentials are configured
 */
export function hasAuthCredentials(): boolean {
  return !!(
    process.env.TEST_NATIONAL_ADMIN_EMAIL ||
    process.env.TEST_SESSION_COOKIE
  );
}

/**
 * Authenticate a user by setting session cookies
 *
 * For staging tests, you have two options:
 * 1. Manual: Log in via browser, export cookies, set TEST_SESSION_COOKIE
 * 2. Automated: Use Firebase Admin SDK to create a custom token
 *
 * @param page - Playwright page
 * @param role - User role to authenticate as
 */
export async function authenticateUser(
  page: Page,
  role: "national_admin" | "chapter_admin" | "member" = "national_admin"
): Promise<boolean> {
  const sessionCookie = process.env.TEST_SESSION_COOKIE;

  if (!sessionCookie) {
    console.warn(
      "No TEST_SESSION_COOKIE set. Skipping authentication.",
      "To enable authenticated tests, set TEST_SESSION_COOKIE environment variable."
    );
    return false;
  }

  // Set the Firebase session cookie
  await page.context().addCookies([
    {
      name: "firebase_token",
      value: sessionCookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false, // localhost doesn't use HTTPS
      sameSite: "Lax",
    },
  ]);

  return true;
}

/**
 * Clear authentication state
 */
export async function clearAuth(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

/**
 * Check if the current page is authenticated
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  return cookies.some((c) => c.name === "firebase_token");
}

/**
 * Wait for authentication redirect to complete
 */
export async function waitForAuthRedirect(page: Page): Promise<void> {
  await page.waitForURL((url) => {
    const path = url.pathname;
    return (
      path.includes("/dashboard") ||
      path.includes("/setup") ||
      path.includes("/signin")
    );
  });
}
