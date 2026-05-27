// Set APPDATA before any require so both transactions.js AND inventory.js (required
// internally by transactions.js) open their NeDB files in the same isolated dir.
const { createTestEnv, removeTestEnv } = require('../helpers/db');
const testDir = createTestEnv('tx');
process.env.APPDATA = testDir;

const request = require('supertest');
const txApp = require('../../api/transactions');
const invApp = require('../../api/inventory'); // same instance used inside transactions.js

afterAll(() => removeTestEnv(testDir));

// ─── helpers ────────────────────────────────────────────────────────────────

function isoNow() { return new Date().toJSON(); }

async function seedProduct(overrides = {}) {
  const res = await request(invApp).post('/product').send({
    id: '', name: 'Widget', price: '10.00', quantity: '5',
    stock: '', category: '0', sku: `W-${Date.now()}`,
    sort: '0', img: '', remove: '', ...overrides,
  });
  return res.body;
}

let _nextOrderId = Date.now();
function makeOrder(product, overrides = {}) {
  const orderId = ++_nextOrderId;
  return {
    _id: orderId, order: orderId,
    ref_number: '', customer: 0, discount: 0,
    subtotal: product.price, tax: 0, order_type: 1,
    items: [{ id: product._id, product_name: product.name, sku: product.sku, price: product.price, quantity: 1 }],
    date: isoNow(),
    payment_type: 'Cash', payment_info: '',
    total: product.price, paid: '', change: '',
    status: 0,
    till: 1, mac: '', user: 'admin', user_id: 1,
    ...overrides,
  };
}

// ─── basic CRUD ──────────────────────────────────────────────────────────────

describe('POST /new — create order', () => {
  it('creates an unpaid (held) order', async () => {
    const product = await seedProduct();
    const order = makeOrder(product, { status: 0, ref_number: 'REF001' });
    const res = await request(txApp).post('/new').send(order);
    expect(res.status).toBe(200);
  });

  it('creates a paid order', async () => {
    const product = await seedProduct({ name: 'Paid Widget', sku: `PW-${Date.now()}` });
    const order = makeOrder(product, { status: 1, paid: product.price, change: '0' });
    const res = await request(txApp).post('/new').send(order);
    expect(res.status).toBe(200);
  });
});

describe('GET /on-hold', () => {
  it('returns only orders with status=0 and a ref_number', async () => {
    const product = await seedProduct({ name: 'Hold Widget', sku: `HW-${Date.now()}` });
    const order = makeOrder(product, { status: 0, ref_number: 'HOLD-TEST' });
    await request(txApp).post('/new').send(order);

    const res = await request(txApp).get('/on-hold');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find(o => o.ref_number === 'HOLD-TEST');
    expect(found).toBeDefined();
  });

  it('does not return paid orders', async () => {
    const product = await seedProduct({ name: 'Paid Out', sku: `PO-${Date.now()}` });
    const order = makeOrder(product, { status: 1, paid: product.price, ref_number: 'PAID-OUT' });
    await request(txApp).post('/new').send(order);

    const res = await request(txApp).get('/on-hold');
    const found = res.body.find(o => o.ref_number === 'PAID-OUT');
    expect(found).toBeUndefined();
  });
});

describe('GET /customer-orders', () => {
  it('returns orders with a customer and status=0 and empty ref_number', async () => {
    const product = await seedProduct({ name: 'CustWidget', sku: `CW-${Date.now()}` });
    const order = makeOrder(product, {
      status: 0, ref_number: '',
      customer: { id: 42, name: 'Alice' },
    });
    await request(txApp).post('/new').send(order);

    const res = await request(txApp).get('/customer-orders');
    expect(res.status).toBe(200);
    const found = res.body.find(o => o.customer && o.customer.name === 'Alice');
    expect(found).toBeDefined();
  });
});

describe('GET /by-date', () => {
  it('returns transactions within the date range', async () => {
    const product = await seedProduct({ name: 'DateWidget', sku: `DW-${Date.now()}` });
    const order = makeOrder(product, { status: 1, paid: product.price });
    await request(txApp).post('/new').send(order);

    const start = new Date(Date.now() - 60000).toJSON();
    const end = new Date(Date.now() + 60000).toJSON();
    const res = await request(txApp).get(`/by-date?start=${start}&end=${end}&user=0&till=0&status=1`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('excludes transactions outside the date range', async () => {
    const start = new Date(Date.now() + 100000).toJSON(); // future
    const end = new Date(Date.now() + 200000).toJSON();
    const res = await request(txApp).get(`/by-date?start=${start}&end=${end}&user=0&till=0&status=1`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('filters by user_id when user != 0', async () => {
    const product = await seedProduct({ name: 'UserWidget', sku: `UW-${Date.now()}` });
    const order = makeOrder(product, { status: 1, paid: product.price, user_id: 999 });
    await request(txApp).post('/new').send(order);

    const start = new Date(Date.now() - 60000).toJSON();
    const end = new Date(Date.now() + 60000).toJSON();
    const res = await request(txApp).get(`/by-date?start=${start}&end=${end}&user=999&till=0&status=1`);
    expect(res.body.every(o => o.user_id === 999)).toBe(true);
  });
});

describe('POST /delete', () => {
  it('removes an order by id', async () => {
    const product = await seedProduct({ name: 'DeleteMe', sku: `DM-${Date.now()}` });
    const order = makeOrder(product, { status: 0, ref_number: 'DEL-ME' });
    await request(txApp).post('/new').send(order);

    const del = await request(txApp).post('/delete').send({ orderId: order._id });
    expect(del.status).toBe(200);

    const held = await request(txApp).get('/on-hold');
    const found = held.body.find(o => o.ref_number === 'DEL-ME');
    expect(found).toBeUndefined();
  });
});

// ─── REGRESSION: PUT /new must decrement inventory ──────────────────────────

describe('REGRESSION: PUT /new (pay a held order) decrements inventory', () => {
  // Bug fixed: previously PUT /new never called decrementInventory, so
  // paying a held order left stock unchanged.

  it('decrements stock when held order is paid via PUT', async () => {
    const product = await seedProduct({
      name: 'HoldStock', sku: `HS-${Date.now()}`, quantity: '6',
    });
    expect(product.stock).toBe(1);

    // Step 1 — create a held order
    const order = makeOrder(product, { status: 0, ref_number: 'HOLD-PAY' });
    await request(txApp).post('/new').send(order);

    // Step 2 — pay it via PUT (simulates cashier resuming a held order)
    const paidOrder = { ...order, status: 1, paid: order.total, change: '0' };
    const putRes = await request(txApp).put('/new').send(paidOrder);
    expect(putRes.status).toBe(200);

    // Step 3 — give decrementInventory (async fire-and-forget) time to run
    await new Promise(r => setTimeout(r, 600));
    const fetched = await request(invApp).get(`/product/${product._id}`);
    expect(parseInt(fetched.body.quantity)).toBe(5); // 6 - 1 = 5
  });

  it('does NOT decrement stock when held order is saved but not yet paid', async () => {
    const product = await seedProduct({
      name: 'UnpaidHold', sku: `UH-${Date.now()}`, quantity: '4',
    });

    const order = makeOrder(product, { status: 0, ref_number: 'HOLD-NOPAY', paid: '' });
    await request(txApp).post('/new').send(order);

    // PUT with paid < total — should not decrement
    const updatedOrder = { ...order, ref_number: 'HOLD-NOPAY-UPDATED' };
    await request(txApp).put('/new').send(updatedOrder);

    await new Promise(r => setTimeout(r, 600));
    const fetched = await request(invApp).get(`/product/${product._id}`);
    expect(parseInt(fetched.body.quantity)).toBe(4); // unchanged
  });
});

describe('REGRESSION: POST /new with stock=0 product does not touch quantity', () => {
  // Bug fixed: decrementInventory previously decremented even stock=0 products
  it('leaves quantity unchanged for a stock-disabled product', async () => {
    const product = await seedProduct({
      name: 'FreeItem', sku: `FI-${Date.now()}`, stock: 'on', quantity: '0',
    });
    expect(product.stock).toBe(0);

    const order = makeOrder(product, { status: 1, paid: product.price });
    await request(txApp).post('/new').send(order);

    await new Promise(r => setTimeout(r, 600));
    const fetched = await request(invApp).get(`/product/${product._id}`);
    expect(fetched.body.quantity).toBe('0'); // untouched
  });
});
