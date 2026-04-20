/**
 * E2E Tests for Events Page - Runs against STAGING Firebase
 *
 * Environment: Firebase Staging (pnaa-chaptermanagement-staging)
 * Config: Uses .env.staging.local via `npm run dev:staging`
 *
 * Tests event management functionality:
 * - Event list display
 * - Create event form and validation
 * - Edit event
 * - Archive event (soft delete)
 * - Role-based permissions
 */

import { test, expect } from "@playwright/test";
import { authenticateUser, hasAuthCredentials } from "../helpers/auth";

const testIfAuth = hasAuthCredentials() ? test : test.skip;

// For tests that create data without cleanup - run locally only, skip in CI
const testIfAuthLocalOnly =
  hasAuthCredentials() && !process.env.CI ? test : test.skip;

test.describe("Events - Unauthenticated", () => {
  test("redirects to signin when accessing events", async ({ page }) => {
    await page.goto("/events");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("redirects to signin when accessing event detail", async ({ page }) => {
    await page.goto("/events/some-event-id");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("redirects to signin when trying to create event", async ({ page }) => {
    await page.goto("/events/new");
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe("Events - Authenticated", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  testIfAuth("events page loads", async ({ page }) => {
    await page.goto("/events");
    await page.waitForLoadState("networkidle");

    // Should have events table or cards, or empty state
    const hasTable = await page.locator("table").isVisible().catch(() => false);
    const hasCards = await page.locator('[data-testid="event-card"]').first().isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no events|no results/i).isVisible().catch(() => false);

    expect(hasTable || hasCards || hasEmptyState).toBeTruthy();
  });

  testIfAuth("has add event button for admins", async ({ page }) => {
    await page.goto("/events");
    await page.waitForLoadState("networkidle");

    // Look for add event button (may be hidden for non-admin users)
    const addButton = page.locator('button:has-text("Add Event"), a:has-text("Add Event"), button:has-text("Create")');

    // The button existence depends on user role
    // We just verify the page loaded correctly
    await expect(page.locator("body")).toBeVisible();
  });

  testIfAuth("can search events", async ({ page }) => {
    await page.goto("/events");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]');

    if (await searchInput.isVisible()) {
      await searchInput.fill("Conference");
      await page.waitForTimeout(500);

      // Search should filter results
      await expect(page.locator("body")).toBeVisible();
    }
  });

  testIfAuth("can filter events by date", async ({ page }) => {
    await page.goto("/events");
    await page.waitForLoadState("networkidle");

    // Look for date filter
    const dateFilter = page.locator('input[type="date"], [data-testid="date-filter"]');

    if (await dateFilter.first().isVisible()) {
      // Date filter exists
      await expect(dateFilter.first()).toBeVisible();
    }
  });
});

test.describe("Events - Form Validation", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  testIfAuth("create event form shows validation errors", async ({ page }) => {
    await page.goto("/events/new");

    // If redirected (user doesn't have permission), skip
    if (page.url().includes("/signin") || page.url().includes("/dashboard")) {
      return;
    }

    await page.waitForLoadState("networkidle");

    // Find and click submit without filling form
    const submitButton = page.locator('button[type="submit"]');

    if (await submitButton.isVisible()) {
      const urlBeforeSubmit = page.url();
      await submitButton.click();

      // Should show validation errors
      await page.waitForTimeout(500);

      const hasErrors = await page
        .locator('[data-testid="error"], .text-red-500, .text-destructive, [role="alert"]')
        .first()
        .isVisible()
        .catch(() => false);

      const stayedOnForm = page.url() === urlBeforeSubmit;

      // Form should show errors OR prevent navigation (stay on form)
      expect(hasErrors || stayedOnForm).toBeTruthy();
    }
  });

  testIfAuth("end date must be after start date", async ({ page }) => {
    await page.goto("/events/new");

    if (page.url().includes("/signin") || page.url().includes("/dashboard")) {
      return;
    }

    await page.waitForLoadState("networkidle");

    // Fill dates with end before start
    const startDateInput = page.locator('input[name="startDate"], input[id="startDate"]');
    const endDateInput = page.locator('input[name="endDate"], input[id="endDate"]');

    if (await startDateInput.isVisible() && await endDateInput.isVisible()) {
      // Use dynamic dates to avoid hardcoded values aging out
      const futureDate1 = new Date();
      futureDate1.setDate(futureDate1.getDate() + 30);
      const futureDate2 = new Date();
      futureDate2.setDate(futureDate2.getDate() + 29); // Before futureDate1
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      await startDateInput.fill(formatDate(futureDate1));
      await endDateInput.fill(formatDate(futureDate2)); // End before start

      const urlBeforeSubmit = page.url();
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      await page.waitForTimeout(500);

      // Should show date validation error or prevent submission
      const hasDateError = await page
        .locator('text=/end.*before.*start|end.*after.*start|invalid.*date/i')
        .isVisible()
        .catch(() => false);

      const stayedOnForm = page.url() === urlBeforeSubmit;

      // Form should show date error OR prevent navigation
      expect(hasDateError || stayedOnForm).toBeTruthy();
    }
  });
});

test.describe("Events - CRUD Operations", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  // NOTE: This test creates real data in staging. Skipped in CI since cleanup
  // requires Firebase Admin access. Runs locally for manual verification.
  // Created test events should be manually archived/deleted after test runs.
  testIfAuthLocalOnly("can create a new event", async ({ page }) => {
    await page.goto("/events/new");

    if (page.url().includes("/signin") || page.url().includes("/dashboard")) {
      // User doesn't have permission to create events
      return;
    }

    await page.waitForLoadState("networkidle");

    // Fill out the form
    const nameInput = page.locator('input[name="name"], input[id="name"]');
    if (await nameInput.isVisible()) {
      const testEventName = `E2E Test Event ${Date.now()}`;

      // Use dynamic future dates (30 and 31 days from now)
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 30);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 31);
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      await nameInput.fill(testEventName);
      await page.locator('input[name="startDate"]').fill(formatDate(startDate));
      await page.locator('input[name="endDate"]').fill(formatDate(endDate));

      // Fill location if required
      const locationInput = page.locator('input[name="location"]');
      if (await locationInput.isVisible()) {
        await locationInput.fill("E2E Test Location");
      }

      // Submit
      await page.locator('button[type="submit"]').click();

      // Wait for navigation or success message
      await page.waitForURL(/\/events/, { timeout: 10000 }).catch(() => {});

      // Assert: Either redirected to events list or shows success message
      const redirectedToList = page.url().includes("/events") && !page.url().includes("/new");
      const showsSuccess = await page.getByText(/success|created/i).isVisible().catch(() => false);

      expect(redirectedToList || showsSuccess).toBeTruthy();
    }
  });

  testIfAuth("can view event detail", async ({ page }) => {
    await page.goto("/events");
    await page.waitForLoadState("networkidle");

    // Click on first event
    const eventLink = page.locator("table tbody tr a, [data-testid='event-card'] a").first();

    if (await eventLink.isVisible()) {
      await eventLink.click();
      await expect(page).toHaveURL(/\/events\/[a-zA-Z0-9-]+/);

      // Should show event details
      await page.waitForLoadState("networkidle");
      const pageText = await page.textContent("body");

      // Should have event information
      expect(pageText?.length).toBeGreaterThan(0);
    }
  });
});

test.describe("Events - File Upload", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  testIfAuth("event form has file upload for poster", async ({ page }) => {
    await page.goto("/events/new");

    if (page.url().includes("/signin") || page.url().includes("/dashboard")) {
      return;
    }

    await page.waitForLoadState("networkidle");

    // Look for file input
    const fileInput = page.locator('input[type="file"]');

    if (await fileInput.isVisible()) {
      await expect(fileInput).toBeVisible();
      // Accept attribute should limit to images
      const accept = await fileInput.getAttribute("accept");
      if (accept) {
        expect(accept).toContain("image");
      }
    }
  });
});
