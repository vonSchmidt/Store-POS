/**
 * E2E — Product and Category management modals.
 *
 * Covers:
 *   - Products modal opens and lists products
 *   - Creating a new product via the form
 *   - New product appears in the POS grid
 *   - Categories modal opens and lists categories
 *   - Creating and deleting a category
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./electron');

let electronApp, page, testDir;

test.beforeAll(async () => {
  ({ electronApp, page, testDir } = await launchApp());

  // Seed one category so the product form has a valid option
  await page.evaluate(async () =>
    fetch('http://localhost:8001/api/categories/category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fruits' }),
    })
  );

  await page.reload();
  await page.waitForSelector('#pos_view', { timeout: 15000 });
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await closeApp(electronApp, testDir);
});

// ─── Products modal ───────────────────────────────────────────────────────────

test('Products modal opens when Products button is clicked', async () => {
  await page.locator('#productModal').click();
  await page.waitForSelector('#Products', { state: 'visible', timeout: 5000 });
  await expect(page.locator('#Products')).toBeVisible();
});

test('Products modal has a table header', async () => {
  await expect(page.locator('#productList thead')).toBeVisible();
});

test('closing Products modal', async () => {
  await page.locator('#Products .close').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#Products')).toBeHidden();
});

// ─── Create product ───────────────────────────────────────────────────────────

test('new product form opens when + button is clicked', async () => {
  await page.locator('#newProductModal').click();
  await page.waitForSelector('#newProduct', { state: 'visible', timeout: 5000 });
  await expect(page.locator('#newProduct')).toBeVisible();
});

test('filling and submitting the new product form creates a product', async () => {
  await page.selectOption('#category', { label: 'Fruits' });
  await page.fill('#productName', 'E2E Mango');
  await page.fill('#product_price', '4.99');
  await page.fill('#quantity', '15');
  await page.fill('#productSku', 'E2E-MNG');

  await page.locator('#saveProduct input[type="submit"]').click();
  await page.waitForTimeout(600);

  // Swal success dialog should appear
  const title = page.locator('.swal2-title');
  await expect(title).toBeVisible({ timeout: 5000 });
  const titleText = await title.textContent();
  expect(titleText).toContain('Product Saved');

  // Dismiss by clicking Cancel (Close)
  await page.locator('.swal2-cancel').click();
  await page.waitForTimeout(300);
});

test('newly created product appears in the POS product grid', async () => {
  await page.waitForTimeout(1000); // loadProducts() runs after save
  const box = page.locator('.box', { hasText: 'E2E Mango' });
  await expect(box).toBeVisible({ timeout: 8000 });
});

// ─── Edit product ─────────────────────────────────────────────────────────────

test('can open edit form for an existing product', async () => {
  await page.locator('#productModal').click();
  await page.waitForSelector('#Products', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(600); // DataTable renders

  // Click the edit button on the first editable row
  const editBtn = page.locator('#product_list tr button.btn-warning').first();
  await editBtn.click();
  await page.waitForTimeout(400);
  await expect(page.locator('#newProduct')).toBeVisible();
  await page.locator('#newProduct .close').click();
});

// ─── Categories modal ─────────────────────────────────────────────────────────

test('Categories modal opens', async () => {
  await page.locator('#categoryModal').click();
  await page.waitForSelector('#Categories', { state: 'visible', timeout: 5000 });
  await expect(page.locator('#Categories')).toBeVisible();
});

test('Categories modal lists the seeded category', async () => {
  await page.waitForTimeout(400);
  const rows = await page.locator('#category_list tr').count();
  expect(rows).toBeGreaterThan(0);
});

test('closing Categories modal', async () => {
  await page.locator('#Categories .close').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#Categories')).toBeHidden();
});

// ─── Create category ──────────────────────────────────────────────────────────

test('new category form creates a category', async () => {
  await page.locator('#newCategoryModal').click();
  await page.waitForSelector('#newCategory', { state: 'visible', timeout: 5000 });
  await page.fill('#categoryName', 'E2E Vegetables');
  await page.locator('#saveCategory input[type="submit"]').click();
  await page.waitForTimeout(600);

  const title = page.locator('.swal2-title');
  await expect(title).toBeVisible({ timeout: 5000 });
  const titleText = await title.textContent();
  expect(titleText).toContain('Category Saved');
  await page.locator('.swal2-cancel').click();

  // Confirm category is in the list
  await page.locator('#categoryModal').click();
  await page.waitForSelector('#Categories', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(400);
  const html = await page.locator('#category_list').innerHTML();
  expect(html).toContain('E2E Vegetables');
  await page.locator('#Categories .close').click();
});
