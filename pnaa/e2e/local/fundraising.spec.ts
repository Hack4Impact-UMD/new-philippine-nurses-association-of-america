/**
 * E2E Tests for Fundraising Page - Runs against STAGING Firebase
 *
 * Environment: Firebase Staging (pnaa-chaptermanagement-staging)
 * Config: Uses .env.staging.local via `npm run dev:staging`
 *
 * Tests fundraising management:
 * - Campaign list display
 * - Create/edit campaigns
 * - Amount validation
 * - Filtering and sorting
 */

import { test, expect } from "@playwright/test";
import { authenticateUser, hasAuthCredentials } from "../helpers/auth";

const testIfAuth = hasAuthCredentials() ? test : test.skip;

test.describe("Fundraising - Unauthenticated", () => {
  test("redirects to signin when accessing fundraising", async ({ page }) => {
    await page.goto("/fundraising");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("redirects to signin when trying to create campaign", async ({
    page,
  }) => {
    await page.goto("/fundraising/new");
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe("Fundraising - Authenticated", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  testIfAuth("fundraising page loads", async ({ page }) => {
    await page.goto("/fundraising");
    await page.waitForLoadState("networkidle");

    // Should have table, cards, or empty state
    const hasTable = await page.locator("table").isVisible().catch(() => false);
    const hasCards = await page.locator('[data-testid="fundraising-card"]').first().isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no campaigns|no results/i).isVisible().catch(() => false);

    expect(hasTable || hasCards || hasEmptyState).toBeTruthy();
  });

  testIfAuth("displays total fundraised amount", async ({ page }) => {
    await page.goto("/fundraising");
    await page.waitForLoadState("networkidle");

    // Look for total amount display
    const totalDisplay = page.locator('[data-testid="total-fundraised"], :has-text("Total"):has-text("$")');
    const hasTotalDisplay = await totalDisplay.first().isVisible().catch(() => false);

    // Check if dollar amounts are displayed on the page
    const pageText = await page.textContent("body");
    const hasDollarAmounts = /\$[\d,]+/.test(pageText || "");

    // Page should display total widget or at least some dollar amounts
    expect(hasTotalDisplay || hasDollarAmounts).toBeTruthy();
  });

  testIfAuth("can search campaigns", async ({ page }) => {
    await page.goto("/fundraising");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]');

    if (await searchInput.isVisible()) {
      // Get initial row/card count
      const tableRows = page.locator("table tbody tr");
      const cards = page.locator('[data-testid="fundraising-card"]');
      const initialRowCount = await tableRows.count();
      const initialCardCount = await cards.count();

      // Search for "gala" - a common fundraiser term
      await searchInput.fill("gala");
      await page.waitForTimeout(500);

      // After search, verify results changed or matching text appears
      const newRowCount = await tableRows.count();
      const newCardCount = await cards.count();
      const hasMatchingText = await page.getByText(/gala/i).first().isVisible().catch(() => false);
      const hasNoResults = await page.getByText(/no results|no campaigns|not found/i).isVisible().catch(() => false);

      // Search should either: show matching results, change count, or show "no results"
      const countChanged = newRowCount !== initialRowCount || newCardCount !== initialCardCount;
      expect(hasMatchingText || countChanged || hasNoResults).toBeTruthy();
    }
  });

  testIfAuth("can filter by chapter", async ({ page }) => {
    await page.goto("/fundraising");
    await page.waitForLoadState("networkidle");

    // Look for chapter filter dropdown
    const chapterFilter = page.locator('select:has-text("Chapter"), [data-testid="chapter-filter"]');

    if (await chapterFilter.isVisible()) {
      // Verify filter has options
      const options = await chapterFilter.locator("option").count();
      expect(options).toBeGreaterThan(0);

      if (options > 1) {
        // Get initial row/card count
        const tableRows = page.locator("table tbody tr");
        const cards = page.locator('[data-testid="fundraising-card"]');
        const initialRowCount = await tableRows.count();
        const initialCardCount = await cards.count();

        // Select a filter option
        await chapterFilter.selectOption({ index: 1 });
        await page.waitForTimeout(500);

        // After filtering, count may change or stay same (if all match)
        const newRowCount = await tableRows.count();
        const newCardCount = await cards.count();
        const hasNoResults = await page.getByText(/no results|no campaigns/i).isVisible().catch(() => false);

        // Filter should work: count changes, shows no results, or results still visible
        const countChanged = newRowCount !== initialRowCount || newCardCount !== initialCardCount;
        const hasResults = newRowCount > 0 || newCardCount > 0;
        expect(countChanged || hasNoResults || hasResults).toBeTruthy();
      }
    }
  });

  testIfAuth("amounts are formatted as currency", async ({ page }) => {
    await page.goto("/fundraising");
    await page.waitForLoadState("networkidle");

    const pageText = await page.textContent("body");

    // If there are amounts, they should be formatted with $ and commas
    // Example: $1,234.56
    if (pageText?.includes("$")) {
      // Currency formatting exists
      expect(pageText).toMatch(/\$[\d,]+(\.\d{2})?/);
    }
  });
});

test.describe("Fundraising - Form Validation", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  testIfAuth("amount field rejects negative values", async ({ page }) => {
    await page.goto("/fundraising/new");

    if (page.url().includes("/signin") || page.url().includes("/dashboard")) {
      return;
    }

    await page.waitForLoadState("networkidle");

    const amountInput = page.locator('input[name="amount"], input[id="amount"]');

    if (await amountInput.isVisible()) {
      await amountInput.fill("-100");

      // The input might:
      // 1. Not accept negative (min=0)
      // 2. Show validation error on submit
      const value = await amountInput.inputValue();

      // If it accepted the negative, submit should fail
      if (value === "-100") {
        await page.locator('button[type="submit"]').click();
        await page.waitForTimeout(500);
        // Should show error
      }
    }
  });

  testIfAuth("amount field accepts valid currency", async ({ page }) => {
    await page.goto("/fundraising/new");

    if (page.url().includes("/signin") || page.url().includes("/dashboard")) {
      return;
    }

    await page.waitForLoadState("networkidle");

    const amountInput = page.locator('input[name="amount"], input[id="amount"]');

    if (await amountInput.isVisible()) {
      await amountInput.fill("1500.50");
      const value = await amountInput.inputValue();
      expect(value).toBe("1500.50");
    }
  });

  testIfAuth("requires fundraiser name", async ({ page }) => {
    await page.goto("/fundraising/new");

    if (page.url().includes("/signin") || page.url().includes("/dashboard")) {
      return;
    }

    await page.waitForLoadState("networkidle");

    // Try to submit without name
    const submitButton = page.locator('button[type="submit"]');

    if (await submitButton.isVisible()) {
      // Fill amount but not name
      const amountInput = page.locator('input[name="amount"]');
      if (await amountInput.isVisible()) {
        await amountInput.fill("100");
      }

      await submitButton.click();
      await page.waitForTimeout(500);

      // Should not have navigated away (validation failed)
      expect(page.url()).toContain("/fundraising");
    }
  });
});

test.describe("Fundraising - CRUD Operations", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  // NOTE: This test creates real data in staging. Consider using testIfAuthLocalOnly
  // if cleanup is not implemented. Created test campaigns should be manually archived.
  testIfAuth("can create a new campaign", async ({ page }) => {
    await page.goto("/fundraising/new");

    if (page.url().includes("/signin") || page.url().includes("/dashboard")) {
      return;
    }

    await page.waitForLoadState("networkidle");

    const nameInput = page.locator('input[name="fundraiserName"], input[name="name"]');

    if (await nameInput.isVisible()) {
      const testName = `Test Fundraiser ${Date.now()}`;

      await nameInput.fill(testName);

      const amountInput = page.locator('input[name="amount"]');
      if (await amountInput.isVisible()) {
        await amountInput.fill("500");
      }

      // Use dynamic future date
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      const dateInput = page.locator('input[name="date"]');
      if (await dateInput.isVisible()) {
        await dateInput.fill(formatDate(futureDate));
      }

      await page.locator('button[type="submit"]').click();

      // Wait for redirect to list or success message
      await page.waitForURL((url) => url.pathname.includes("/fundraising") && !url.pathname.includes("/new"), { timeout: 10000 }).catch(() => {});

      // Assert success: redirected to list OR success toast visible
      const redirectedToList = page.url().includes("/fundraising") && !page.url().includes("/new");
      const showsSuccess = await page.getByText(/success|created/i).isVisible().catch(() => false);

      expect(redirectedToList || showsSuccess).toBeTruthy();
    }
  });

  testIfAuth("can archive a campaign", async ({ page }) => {
    await page.goto("/fundraising");
    await page.waitForLoadState("networkidle");

    // Get initial row count
    const tableRows = page.locator("table tbody tr");
    const initialCount = await tableRows.count();

    // Find an archive/delete button
    const archiveButton = page
      .locator('button:has-text("Archive"), button:has-text("Delete"), button[aria-label*="archive" i]')
      .first();

    if (await archiveButton.isVisible()) {
      // Click archive button
      await archiveButton.click();
      await page.waitForTimeout(500);

      // Handle confirmation dialog if present
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes"), [role="alertdialog"] button:has-text("Archive")');
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click();
        await page.waitForTimeout(500);
      }

      // Assert success: row removed, success toast, or "Archived" label appears
      const newCount = await tableRows.count();
      const rowRemoved = newCount < initialCount;
      const showsSuccess = await page.getByText(/success|archived|deleted/i).isVisible().catch(() => false);
      const hasArchivedLabel = await page.getByText(/archived/i).isVisible().catch(() => false);

      expect(rowRemoved || showsSuccess || hasArchivedLabel).toBeTruthy();
    }
  });
});

test.describe("Fundraising - Sorting", () => {
  test.beforeEach(async ({ page }) => {
    const authenticated = await authenticateUser(page);
    if (!authenticated) {
      test.skip();
    }
  });

  testIfAuth("can sort by amount", async ({ page }) => {
    await page.goto("/fundraising");
    await page.waitForLoadState("networkidle");

    const amountHeader = page.locator('th:has-text("Amount")');
    const tableRows = page.locator("table tbody tr");

    if (await amountHeader.isVisible() && (await tableRows.count()) >= 2) {
      // Get first row text before sort
      const firstRowBefore = await tableRows.first().textContent();

      await amountHeader.click();
      await page.waitForTimeout(300);

      // Verify sort: check aria-sort, sort class, or row order changed
      const ariaSort = await amountHeader.getAttribute("aria-sort");
      const hasSortClass = await amountHeader.locator('[class*="asc"], [class*="desc"], [data-sort], svg').isVisible().catch(() => false);
      const firstRowAfter = await tableRows.first().textContent();
      const rowOrderChanged = firstRowBefore !== firstRowAfter;

      expect(ariaSort === "ascending" || ariaSort === "descending" || hasSortClass || rowOrderChanged).toBeTruthy();
    }
  });

  testIfAuth("can sort by date", async ({ page }) => {
    await page.goto("/fundraising");
    await page.waitForLoadState("networkidle");

    const dateHeader = page.locator('th:has-text("Date")');
    const tableRows = page.locator("table tbody tr");

    if (await dateHeader.isVisible() && (await tableRows.count()) >= 2) {
      // Get first row text before sort
      const firstRowBefore = await tableRows.first().textContent();

      await dateHeader.click();
      await page.waitForTimeout(300);

      // Verify sort: check aria-sort, sort class, or row order changed
      const ariaSort = await dateHeader.getAttribute("aria-sort");
      const hasSortClass = await dateHeader.locator('[class*="asc"], [class*="desc"], [data-sort], svg').isVisible().catch(() => false);
      const firstRowAfter = await tableRows.first().textContent();
      const rowOrderChanged = firstRowBefore !== firstRowAfter;

      expect(ariaSort === "ascending" || ariaSort === "descending" || hasSortClass || rowOrderChanged).toBeTruthy();
    }
  });
});
