/**
 * Authentication Helpers for E2E Tests
 *
 * These helpers manage authentication state for Playwright tests
 * running against the STAGING Firebase environment.
 *
 * Setup Instructions:
 * 1. Log in to the staging app manually in a browser
 * 2. Copy the `firebase_token` cookie value from DevTools
 * 3. Set the environment variable:
 *    TEST_SESSION_COOKIE=<your-firebase-token-value>
 *
 * The cookie is validated server-side by the app's middleware.
 * Cookie expires after ~1 hour, so refresh before long test sessions.
 *
 * Usage in tests:
 * ```typescript
 * import { authenticateUser, hasAuthCredentials } from '../helpers/auth';
 *
 * test.beforeEach(async ({ page }) => {
 *   await authenticateUser(page);
 * });
 * ```
 */

import { Page, BrowserContext } from "@playwright/test";

// Path to store authenticated session state
export const AUTH_STORAGE_STATE = "e2e/.auth/user.json";

/**
 * Check if authentication credentials are configured.
 * Returns true only if TEST_SESSION_COOKIE is set, since that's
 * what authenticateUser() actually uses.
 */
export function hasAuthCredentials(): boolean {
  return !!process.env.TEST_SESSION_COOKIE;
}

/**
 * Authenticate a user by setting the Firebase session cookie.
 *
 * The cookie is validated server-side by the app's middleware,
 * which then establishes the Firebase auth session.
 *
 * @param page - Playwright page
 * @returns true if authentication was set up, false if no credentials available
 */
export async function authenticateUser(page: Page): Promise<boolean> {
  const sessionCookie = process.env.TEST_SESSION_COOKIE;

  if (!sessionCookie) {
    console.warn(
      "No TEST_SESSION_COOKIE set. Skipping authentication.",
      "To enable authenticated tests, set TEST_SESSION_COOKIE environment variable."
    );
    return false;
  }

  // Set the Firebase session cookie - validated server-side by middleware
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
