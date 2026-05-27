/**
 * E2E — App launch and core UI regression tests.
 *
 * Covers:
 *   - App starts and POS view renders
 *   - REGRESSION: #total uses <span> not the old <sapn> typo
 *   - REGRESSION: payablePrice input is NOT trapped inside an unclosed <span>
 *   - Toolbar buttons are present
 *   - Switching between POS and Transactions views
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./electron');

let electronApp, page, testDir;

test.beforeAll(async () => {
  ({ electronApp, page, testDir } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(electronApp, testDir);
});

// ─── launch ──────────────────────────────────────────────────────────────────

test('POS view is visible after login', async () => {
  await expect(page.locator('#pos_view')).toBeVisible();
});

test('transactions view is hidden on start', async () => {
  await expect(page.locator('#transactions_view')).toBeHidden();
});

// ─── REGRESSION: HTML typo fixes ─────────────────────────────────────────────

test('REGRESSION: #total element is a <span>, not the old <sapn> typo', async () => {
  // Before fix: <sapn id="total"> — jQuery couldn't update the cart count correctly
  const tagName = await page.locator('#total').evaluate(el => el.tagName.toLowerCase());
  expect(tagName).toBe('span');
});

test('REGRESSION: payablePrice input is outside the input-group-addon span', async () => {
  // Before fix: the <span class="input-group-addon"> was never closed, swallowing
  // the <input id="payablePrice"> and breaking the Bootstrap input-group layout.
  // After fix: input is a sibling of the span, not a child.
  await page.locator('#payButton').click();
  await page.waitForSelector('#paymentModel.in, #paymentModel[style*="display: block"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  const isInsideAddon = await page.locator('#payablePrice').evaluate(el => {
    let parent = el.parentElement;
    while (parent) {
      if (parent.classList.contains('input-group-addon')) return true;
      if (parent.id === 'paymentModel') break;
      parent = parent.parentElement;
    }
    return false;
  });
  expect(isInsideAddon).toBe(false);

  // Close modal
  await page.keyboard.press('Escape');
});

// ─── toolbar ─────────────────────────────────────────────────────────────────

test('Products button is visible in toolbar', async () => {
  await expect(page.locator('#productModal')).toBeVisible();
});

test('Categories button is visible in toolbar', async () => {
  await expect(page.locator('#categoryModal')).toBeVisible();
});

test('Settings button is visible in toolbar', async () => {
  await expect(page.locator('#settings')).toBeVisible();
});

test('Logged-in user name is displayed', async () => {
  const text = await page.locator('#loggedin-user').textContent();
  expect(text.trim().length).toBeGreaterThan(0);
});

// ─── view switching ───────────────────────────────────────────────────────────

test('clicking Transactions shows transaction view and hides POS', async () => {
  await page.locator('#transactions').click();
  await expect(page.locator('#transactions_view')).toBeVisible();
  await expect(page.locator('#pos_view')).toBeHidden();
});

test('clicking Point of Sale restores POS view', async () => {
  // loadTransactions() fires a "No data!" Swal when the DB is empty — dismiss it first
  await page.evaluate(() => { try { require('sweetalert2').close(); } catch (_) {} });
  await page.waitForTimeout(300);
  await page.locator('#pointofsale').click();
  await expect(page.locator('#pos_view')).toBeVisible();
  await expect(page.locator('#transactions_view')).toBeHidden();
});
