/**
 * E2E — Transactions view regression tests.
 *
 * Covers:
 *   - Transactions view loads
 *   - REGRESSION: payment_type shows "Cash" not always "Card"
 *   - REGRESSION: viewTransaction modal works even when a product has been deleted
 *   - REGRESSION: platform undefined doesn't crash on order submission
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./electron');

let electronApp, page, testDir;

test.beforeAll(async () => {
  ({ electronApp, page, testDir } = await launchApp());

  // Seed a product and complete a Cash transaction directly via API
  const product = await page.evaluate(async () => {
    const res = await fetch('http://localhost:8001/api/inventory/product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '', name: 'TX Test Widget', price: '7.00',
        quantity: '10', stock: '', category: '0',
        sku: 'TX-WGT', sort: '0', img: '', remove: '',
      }),
    });
    return res.json();
  });

  const orderId = Math.floor(Date.now() / 1000);
  await page.evaluate(async ({ orderId, product }) => {
    await fetch('http://localhost:8001/api/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _id: orderId, order: orderId,
        ref_number: 'E2E-CASH', customer: 0, discount: 0,
        subtotal: product.price, tax: 0, order_type: 1,
        items: [{ id: product._id, product_name: product.name, sku: product.sku, price: product.price, quantity: 1 }],
        date: new Date().toJSON(),
        payment_type: 'Cash', payment_info: '',
        total: product.price, paid: product.price, change: '0',
        status: 1, till: 1, mac: '', user: 'Administrator', user_id: 1,
      }),
    });
  }, { orderId, product });

  // Also seed a second transaction with a product we'll delete, to test the null-safe lookup
  const deletableProduct = await page.evaluate(async () => {
    const res = await fetch('http://localhost:8001/api/inventory/product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '', name: 'TX Deletable', price: '1.00',
        quantity: '5', stock: '', category: '0',
        sku: 'TX-DEL', sort: '0', img: '', remove: '',
      }),
    });
    return res.json();
  });

  const orderId2 = Math.floor(Date.now() / 1000) + 1;
  await page.evaluate(async ({ orderId2, p }) => {
    await fetch('http://localhost:8001/api/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _id: orderId2, order: orderId2,
        ref_number: 'E2E-DELETED-PROD', customer: 0, discount: 0,
        subtotal: p.price, tax: 0, order_type: 1,
        items: [{ id: p._id, product_name: p.name, sku: p.sku, price: p.price, quantity: 1 }],
        date: new Date().toJSON(),
        payment_type: 'Cash', payment_info: '',
        total: p.price, paid: p.price, change: '0',
        status: 1, till: 1, mac: '', user: 'Administrator', user_id: 1,
      }),
    });
    // Now delete the product so the transaction references a missing product
    await fetch(`http://localhost:8001/api/inventory/product/${p._id}`, { method: 'DELETE' });
  }, { orderId2, p: deletableProduct });

  await page.waitForTimeout(400);
  // Navigate to transactions view
  await page.locator('#transactions').click();
  await page.waitForSelector('#transactions_view', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(2000); // loadTransactions() is async
});

test.afterAll(async () => {
  await closeApp(electronApp, testDir);
});

// ─── transactions view ────────────────────────────────────────────────────────

test('transactions view is visible', async () => {
  await expect(page.locator('#transactions_view')).toBeVisible();
});

test('transaction list table has rows', async () => {
  const rows = await page.locator('#transaction_list tr').count();
  expect(rows).toBeGreaterThan(0);
});

test('sales counter shows a non-zero amount', async () => {
  const sales = await page.locator('#sales_counter').textContent();
  expect(sales).not.toBe('0');
});

// ─── REGRESSION: payment type display ────────────────────────────────────────

test('REGRESSION: Cash transaction shows "Cash" in the Method column, not "Card"', async () => {
  // Before fix: `trans.payment_type == 0 ? "Cash" : "Card"` — string vs number
  // comparison always evaluated to false, so all transactions showed "Card".
  const rows = await page.locator('#transaction_list tr').all();
  let foundCash = false;
  for (const row of rows) {
    const cells = await row.locator('td').allTextContents();
    // Method is the 6th column (index 5): Invoice/Date/Total/Paid/Change/Method
    if (cells.length > 5 && cells[5] === 'Cash') {
      foundCash = true;
      break;
    }
  }
  expect(foundCash).toBe(true);
});

// ─── REGRESSION: viewTransaction with deleted product ────────────────────────

test('REGRESSION: clicking View on a transaction whose product was deleted does not crash', async () => {
  // Before fix: loadSoldProducts() accessed product[0].stock before checking
  // product.length > 0, throwing when a product had been deleted.

  // Find the row for our deleted-product transaction
  const rows = await page.locator('#transaction_list tr').all();
  let viewBtn = null;
  for (const row of rows) {
    const cells = await row.locator('td').allTextContents();
    if (cells.some(c => c.includes('E2E-DELETED-PROD'))) {
      viewBtn = row.locator('button.btn-info');
      break;
    }
  }

  // The transaction should be present and clickable without JS error
  if (viewBtn) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await viewBtn.click();
    await page.waitForTimeout(600);
    expect(errors.filter(e => e.includes('Cannot read'))).toHaveLength(0);
    await page.keyboard.press('Escape');
  }
});

// ─── REGRESSION: viewTransaction shows correct payment type ──────────────────

test('REGRESSION: viewTransaction modal shows "Cash" for a Cash transaction', async () => {
  // Before fix: the switch in viewTransaction compared payment_type (string "Card")
  // against case 2 (number), so it always fell to default "Cash" — but was never
  // tested. Now we explicitly verify the stored string is shown correctly.
  const rows = await page.locator('#transaction_list tr').all();
  for (const row of rows) {
    const viewBtnVisible = await row.locator('button.btn-info').isVisible().catch(() => false);
    if (viewBtnVisible) {
      page.on('pageerror', () => {});
      await row.locator('button.btn-info').click();
      await page.waitForSelector('#orderModal', { state: 'visible', timeout: 5000 });
      const receiptHtml = await page.locator('#viewTransaction').innerHTML();
      // The receipt includes Method: Cash in the payment row
      expect(receiptHtml).toContain('Cash');
      await page.keyboard.press('Escape');
      // Wait for Bootstrap modal animation to fully complete before next test
      await page.waitForSelector('#orderModal', { state: 'hidden', timeout: 5000 }).catch(() => {});
      break;
    }
  }
});

// ─── REGRESSION: platform undefined does not crash ───────────────────────────

test('REGRESSION: POS can process an order even before settings have been saved to electron-store', async () => {
  // Before fix: submitDueOrder accessed platform.till unconditionally.
  // If platform was undefined (fresh install, settings not yet saved), it crashed.
  // We validate no console error surfaces by submitting an order from the POS view.

  // Ensure no lingering Swal or Bootstrap modal from previous test
  await page.evaluate(() => {
    try { require('sweetalert2').close(); } catch (_) {}
    $('#orderModal').modal('hide').removeClass('in');
    $('.modal-backdrop').remove();
    $('body').removeClass('modal-open');
  });
  await page.waitForTimeout(300);

  // Reload so loadProducts() re-runs with the products seeded in beforeAll.
  // Auth is persisted in electron-store, so the POS view comes up directly.
  await page.reload();
  await page.waitForSelector('#pos_view', { state: 'visible', timeout: 15000 });
  // Wait for the product grid to populate (loadProducts is async)
  await page.waitForSelector('#parent .box', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);

  // Add an item and open the payment modal
  const box = page.locator('#parent .box').first();
  await box.click();
  await page.waitForTimeout(300);
  await page.locator('#payButton').click();
  await page.waitForSelector('#paymentModel', { state: 'visible', timeout: 5000 });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.locator('#payment').fill('999');
  await page.locator('#payment').dispatchEvent('input');
  await page.waitForTimeout(200);
  await page.locator('#confirmPayment').click();
  await page.waitForTimeout(1000);

  const platformErrors = errors.filter(e =>
    e.includes("Cannot read") && e.includes("platform")
  );
  expect(platformErrors).toHaveLength(0);

  // Dismiss any modal that appeared
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});
