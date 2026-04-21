/**
 * E2E Tests for Chapters Page - Runs against STAGING Firebase
 *
 * Environment: Firebase Staging (pnaa-chaptermanagement-staging)
 * Config: Uses .env.staging.local via `npm run dev:staging`
 *
 * Tests chapter management functionality:
 * - Chapter list display (table and card views)
 * - Filtering and sorting
 * - Chapter detail navigation
 * - Data table features
 */

import { test, expect } from "@playwright/test";
import { authenticateUser, hasAuthCredentials } from "../helpers/auth";

// Skip authenticated tests if no credentials are configured
const testIfAuth = hasAuthCredentials() ? test : test.skip;

test.describe("Chapters - Unauthenticated", () => {
  test("redirects to signin when accessing chapters", async ({ page }) => {
    await page.goto("/chapters");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("redirects to signin when accessing chapter detail", async ({
    page,
  }) => {
    await page.goto("/chapters/some-chapter-id");
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe("Chapters - Authenticated", () => {
  // These tests require authentication
  // Set TEST_SESSION_COOKIE environment variable to enable

  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  testIfAuth("chapters page loads and displays table", async ({ page }) => {
    await page.goto("/chapters");

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Should have a table or card view
    const hasTable = await page.locator("table").isVisible();
    const hasCards = await page.locator('[data-testid="chapter-card"]').first().isVisible().catch(() => false);

    expect(hasTable || hasCards).toBeTruthy();
  });

  testIfAuth("can toggle between table and card view", async ({ page }) => {
    await page.goto("/chapters");
    await page.waitForLoadState("networkidle");

    // Find view toggle buttons
    const tableToggle = page.locator('[data-testid="view-toggle-table"], button:has-text("Table")');
    const cardToggle = page.locator('[data-testid="view-toggle-card"], button:has-text("Card")');

    // If toggles exist, test them
    if (await tableToggle.isVisible()) {
      await cardToggle.click();
      // After clicking card, should show cards
      await expect(page.locator('[data-testid="chapter-card"]').first()).toBeVisible({ timeout: 5000 });

      await tableToggle.click();
      // After clicking table, should show table
      await expect(page.locator("table")).toBeVisible({ timeout: 5000 });
    }
  });

  testIfAuth("can search chapters", async ({ page }) => {
    await page.goto("/chapters");
    await page.waitForLoadState("networkidle");

    // Find search input
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]');

    if (await searchInput.isVisible()) {
      await searchInput.fill("Chicago");
      await page.waitForTimeout(500); // Wait for debounce

      // Results should be filtered
      const tableRows = page.locator("table tbody tr");
      const rowCount = await tableRows.count();

      // If there are results, they should contain "Chicago"
      if (rowCount > 0) {
        const firstRowText = await tableRows.first().textContent();
        expect(firstRowText?.toLowerCase()).toContain("chicago");
      }
    }
  });

  testIfAuth("can sort by column", async ({ page }) => {
    await page.goto("/chapters");
    await page.waitForLoadState("networkidle");

    // Find a sortable column header (e.g., "Total Members")
    const sortableHeader = page.locator('th:has-text("Total Members"), th:has-text("Members")');

    if (await sortableHeader.isVisible()) {
      const tableRows = page.locator("table tbody tr");
      const firstRowBefore = await tableRows.first().textContent().catch(() => "");

      // Click to sort ascending
      await sortableHeader.click();
      await page.waitForTimeout(300);

      // Click again for descending
      await sortableHeader.click();
      await page.waitForTimeout(300);

      // Verify sort: check for sort icon or row order changed
      const hasSortIcon = await sortableHeader.locator('button svg').count() > 0;
      const firstRowAfter = await tableRows.first().textContent().catch(() => "");
      const rowOrderChanged = firstRowBefore !== firstRowAfter;

      expect(hasSortIcon || rowOrderChanged).toBeTruthy();
    }
  });

  testIfAuth("can navigate to chapter detail", async ({ page }) => {
    await page.goto("/chapters");
    await page.waitForLoadState("networkidle");

    // Click on first chapter - table row uses onRowClick, card is wrapped in Link
    const tableRow = page.locator("table tbody tr").first();
    const chapterCard = page.locator('[data-testid="chapter-card"]').first();

    if (await tableRow.isVisible()) {
      await tableRow.click();
      await expect(page).toHaveURL(/\/chapters\/[a-zA-Z0-9-]+/);
    } else if (await chapterCard.isVisible()) {
      await chapterCard.click();
      await expect(page).toHaveURL(/\/chapters\/[a-zA-Z0-9-]+/);
    }
  });

  testIfAuth("chapter detail shows member counts", async ({ page }) => {
    await page.goto("/chapters");
    await page.waitForLoadState("networkidle");

    // Navigate to first chapter - table row uses onRowClick, card is wrapped in Link
    const tableRow = page.locator("table tbody tr").first();
    const chapterCard = page.locator('[data-testid="chapter-card"]').first();

    let navigated = false;
    if (await tableRow.isVisible()) {
      await tableRow.click();
      navigated = true;
    } else if (await chapterCard.isVisible()) {
      await chapterCard.click();
      navigated = true;
    }

    if (navigated) {
      await page.waitForLoadState("networkidle");

      // Should show member statistics
      const pageText = await page.textContent("body");
      expect(
        pageText?.includes("member") ||
          pageText?.includes("Member") ||
          pageText?.includes("Active") ||
          pageText?.includes("Lapsed")
      ).toBeTruthy();
    }
  });
});

test.describe("Chapters - Pagination", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  testIfAuth("pagination controls are visible", async ({ page }) => {
    await page.goto("/chapters");
    await page.waitForLoadState("networkidle");

    // Look for pagination elements
    const pagination = page.locator('[data-testid="pagination"], nav[aria-label*="pagination" i], .pagination');
    const nextButton = page.locator('button:has-text("Next"), button[aria-label*="next" i]');
    const pageNumbers = page.locator('[data-testid^="page-"], button:has-text(/^[0-9]+$/)');

    // Check if pagination controls exist
    const hasPaginationNav = await pagination.isVisible().catch(() => false);
    const hasNextButton = await nextButton.isVisible().catch(() => false);
    const hasPageNumbers = await pageNumbers.first().isVisible().catch(() => false);
    const hasPagination = hasPaginationNav || hasNextButton || hasPageNumbers;

    // Check row count to determine if pagination should exist
    const rowCount = await page.locator("table tbody tr").count();

    // Skip if not enough data for pagination (less than default page size)
    if (rowCount < 20 && !hasPagination) {
      test.skip(true, "Not enough data for pagination");
      return;
    }

    // If we have enough data, pagination should be visible
    expect(hasPagination).toBeTruthy();
  });

  testIfAuth("can navigate between pages", async ({ page }) => {
    await page.goto("/chapters");
    await page.waitForLoadState("networkidle");

    const nextButton = page.locator('button:has-text("Next"), button[aria-label*="next" i]').first();
    const hasNextButton = await nextButton.isVisible().catch(() => false);
    const isEnabled = hasNextButton && await nextButton.isEnabled().catch(() => false);

    // Skip if pagination is not available
    if (!hasNextButton || !isEnabled) {
      test.skip(true, "Next button not visible or not enabled - not enough data for pagination");
      return;
    }

    // Get initial content before navigation
    const initialContent = await page.locator("table tbody tr").first().textContent();

    await nextButton.click();
    await page.waitForTimeout(500);

    // After clicking next, content should change OR button should become disabled (last page)
    const newContent = await page.locator("table tbody tr").first().textContent();
    const buttonNowDisabled = !(await nextButton.isEnabled().catch(() => true));
    const contentChanged = newContent !== initialContent;

    expect(contentChanged || buttonNowDisabled).toBeTruthy();
  });
});
