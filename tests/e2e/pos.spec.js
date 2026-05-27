/**
 * E2E — POS / cart / payment tests.
 *
 * Covers:
 *   - Adding a product to cart via product grid
 *   - Quantity increment and decrement
 *   - Cart total recalculates correctly
 *   - Cancel cart
 *   - REGRESSION: barcode search works for stock=0 (unlimited) products
 *   - Payment modal: price displayed, change calculation, confirm button
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./electron');

let electronApp, page, testDir;
let trackedProduct, unlimitedProduct;

test.beforeAll(async () => {
  ({ electronApp, page, testDir } = await launchApp());

  // Seed products via the embedded API
  trackedProduct = await page.evaluate(async () => {
    const res = await fetch('http://localhost:8001/api/inventory/product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '', name: 'POS Test Apple', price: '3.00',
        quantity: '20', stock: '', category: '0',
        sku: 'ETEST-APPLE', sort: '0', img: '', remove: '',
      }),
    });
    return res.json();
  });

  unlimitedProduct = await page.evaluate(async () => {
    const res = await fetch('http://localhost:8001/api/inventory/product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '', name: 'POS Unlimited Item', price: '5.00',
        quantity: '0', stock: 'on', category: '0',
        sku: 'ETEST-UNLIM', sort: '0', img: '', remove: '',
      }),
    });
    return res.json();
  });

  // Reload so the POS grid picks up the seeded products
  await page.reload();
  await page.waitForSelector('#pos_view', { timeout: 15000 });
  await page.waitForTimeout(1500); // let loadProducts() finish
});

test.afterAll(async () => {
  await closeApp(electronApp, testDir);
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function clearCart() {
  // Dismiss any stale Swal that might block clicks
  await page.evaluate(() => { try { require('sweetalert2').close(); } catch (_) {} });
  await page.waitForTimeout(200);
  const rows = await page.locator('#cartTable tbody tr').count();
  if (rows > 0) {
    await page.locator('button.btn-danger[onclick*="cancelOrder"]').first().click();
    const confirmBtn = page.locator('.swal2-confirm');
    if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(600);
      // cancelOrder fires a second "Cleared!" Swal — dismiss it
      await page.evaluate(() => { try { require('sweetalert2').close(); } catch (_) {} });
      await page.waitForTimeout(200);
    }
  }
}

// ─── cart basics ─────────────────────────────────────────────────────────────

test('product grid renders products', async () => {
  const boxes = page.locator('#parent .box');
  await expect(boxes.first()).toBeVisible({ timeout: 8000 });
  const count = await boxes.count();
  expect(count).toBeGreaterThan(0);
});

test('clicking a product adds it to the cart', async () => {
  await clearCart();
  // Click the "POS Test Apple" box
  await page.locator('.box', { hasText: 'POS Test Apple' }).click();
  await page.waitForTimeout(300);
  const rows = await page.locator('#cartTable tbody tr').count();
  expect(rows).toBe(1);
});

test('cart shows correct item count in #total', async () => {
  const total = await page.locator('#total').textContent();
  expect(total.trim()).toBe('1');
});

test('adding the same product increments quantity, not rows', async () => {
  await page.locator('.box', { hasText: 'POS Test Apple' }).click();
  await page.waitForTimeout(300);
  const rows = await page.locator('#cartTable tbody tr').count();
  expect(rows).toBe(1); // still one row, not two

  const qtyInput = page.locator('#cartTable tbody tr:first-child input[type="number"]');
  const qty = await qtyInput.inputValue();
  expect(parseInt(qty)).toBe(2);
});

test('increment (+) button increases quantity', async () => {
  const plusBtn = page.locator('#cartTable tbody tr:first-child .input-group-btn:last-child button');
  await plusBtn.click();
  await page.waitForTimeout(200);
  const qty = await page.locator('#cartTable tbody tr:first-child input[type="number"]').inputValue();
  expect(parseInt(qty)).toBe(3);
});

test('decrement (-) button decreases quantity', async () => {
  const minusBtn = page.locator('#cartTable tbody tr:first-child .input-group-btn:first-child button');
  await minusBtn.click();
  await page.waitForTimeout(200);
  const qty = await page.locator('#cartTable tbody tr:first-child input[type="number"]').inputValue();
  expect(parseInt(qty)).toBe(2);
});

test('gross price updates when quantity changes', async () => {
  const price = await page.locator('#gross_price').textContent();
  // 2 × $3.00 = $6.00
  expect(price).toContain('6.00');
});

test('remove button deletes item from cart', async () => {
  await page.locator('#cartTable tbody tr:first-child .btn-danger').click();
  await page.waitForTimeout(200);
  const rows = await page.locator('#cartTable tbody tr').count();
  expect(rows).toBe(0);
});

test('cancel order clears all items after confirmation', async () => {
  await page.locator('.box', { hasText: 'POS Test Apple' }).click();
  await page.waitForTimeout(300);
  await page.locator('button.btn-danger[onclick*="cancelOrder"]').first().click();
  await page.locator('.swal2-confirm').click();
  await page.waitForTimeout(400);
  const rows = await page.locator('#cartTable tbody tr').count();
  expect(rows).toBe(0);
});

// ─── REGRESSION: barcode scan with stock=0 product ───────────────────────────

test('REGRESSION: barcode scan adds a stock-disabled (unlimited) product to cart', async () => {
  // Before fix: barcodeSearch checked `data.quantity >= 1` before adding, so
  // stock=0 products with quantity=0 were rejected with "Out of stock".
  await clearCart();
  await page.fill('#skuCode', 'ETEST-UNLIM');
  await page.press('#skuCode', 'Enter');
  await page.waitForTimeout(600);

  // Should not show out-of-stock alert
  const swalTitle = page.locator('.swal2-title');
  const alertVisible = await swalTitle.isVisible({ timeout: 800 }).catch(() => false);
  if (alertVisible) {
    const alertText = await swalTitle.textContent();
    expect(alertText).not.toContain('Out of stock');
    await page.keyboard.press('Escape');
  }

  const rows = await page.locator('#cartTable tbody tr').count();
  expect(rows).toBe(1);
  await clearCart();
});

// ─── payment modal ────────────────────────────────────────────────────────────

test('Pay button opens the payment modal', async () => {
  await page.locator('.box', { hasText: 'POS Test Apple' }).click();
  await page.waitForTimeout(300);
  await page.locator('#payButton').click();
  await page.waitForSelector('#paymentModel', { state: 'visible', timeout: 5000 });
  await expect(page.locator('#paymentModel')).toBeVisible();
});

test('payablePrice input shows the cart total', async () => {
  const price = await page.locator('#payablePrice').inputValue();
  expect(parseFloat(price)).toBeCloseTo(3.00, 1);
});

test('REGRESSION: payablePrice input is interactable (not inside broken span)', async () => {
  // If the <span class="input-group-addon"> was unclosed, the input would be
  // inside it and visually broken / not part of the input-group correctly.
  await expect(page.locator('#payablePrice')).toBeVisible();
  const box = await page.locator('#payablePrice').boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(50);
});

test('confirm payment button is hidden until enough is entered', async () => {
  await expect(page.locator('#confirmPayment')).toBeHidden();
});

test('entering exact payment amount shows confirm button and zero change', async () => {
  await page.locator('#payment').fill('3.00');
  await page.locator('#payment').dispatchEvent('input');
  await page.waitForTimeout(300);
  await expect(page.locator('#confirmPayment')).toBeVisible();
  const change = await page.locator('#change').textContent();
  expect(parseFloat(change)).toBe(0);
});

test('entering overpayment shows correct change', async () => {
  await page.locator('#payment').fill('5.00');
  await page.locator('#payment').dispatchEvent('input');
  await page.waitForTimeout(200);
  const change = await page.locator('#change').textContent();
  expect(parseFloat(change)).toBeCloseTo(-2.00, 1); // change is stored negative
});

test('close payment modal without paying', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await clearCart();
});

// ─── category filter ─────────────────────────────────────────────────────────

test('All category button shows all products', async () => {
  await page.evaluate(() => { try { require('sweetalert2').close(); } catch (_) {} });
  await page.waitForTimeout(200);
  await page.locator('#all').click();
  await page.waitForTimeout(300);
  const visible = await page.locator('#parent .box').filter({ visible: true }).count();
  expect(visible).toBeGreaterThan(0);
});

// ─── product search ───────────────────────────────────────────────────────────

test('search field filters products by name', async () => {
  await page.fill('#search', 'POS Test Apple');
  await page.waitForTimeout(400);
  const visible = await page.locator('#parent .box').filter({ visible: true }).count();
  expect(visible).toBeGreaterThanOrEqual(1);
  const total = await page.locator('#parent .box').count();
  expect(total - visible).toBeGreaterThan(0); // at least one hidden by the filter
  await page.fill('#search', ''); // reset
});
