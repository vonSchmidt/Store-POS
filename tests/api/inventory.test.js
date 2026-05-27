// IMPORTANT: set APPDATA before any require so NeDB opens files in the right place
const { createTestEnv, removeTestEnv } = require('../helpers/db');
const testDir = createTestEnv('inv');
process.env.APPDATA = testDir;

const request = require('supertest');
const app = require('../../api/inventory');

afterAll(() => removeTestEnv(testDir));

// ─── helpers ────────────────────────────────────────────────────────────────

async function createProduct(overrides = {}) {
  const defaults = {
    id: '', name: 'Apple', price: '2.50', quantity: '10',
    stock: '', category: '1', sku: `SKU-${Date.now()}`,
    sort: '0', img: '', remove: '',
  };
  const res = await request(app).post('/product').send({ ...defaults, ...overrides });
  return res;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

describe('GET /products', () => {
  it('returns an empty array on a fresh database', async () => {
    const res = await request(app).get('/products');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /product — create', () => {
  it('creates a stock-tracked product and returns it', async () => {
    const res = await createProduct({ name: 'Banana', sku: 'BAN001' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Banana');
    expect(res.body._id).toBeDefined();
    expect(res.body.stock).toBe(1); // stock tracking on by default
  });

  it('creates a product with stock tracking disabled (stock=0)', async () => {
    const res = await createProduct({ name: 'Service', stock: 'on', quantity: '0', sku: 'SVC001' });
    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(0); // 'on' maps to 0 (disabled)
  });

  it('auto-generates _id when id is empty', async () => {
    const res = await createProduct({ name: 'Cherry', sku: 'CHR001' });
    expect(typeof res.body._id).toBe('number');
  });
});

describe('GET /product/:id', () => {
  it('retrieves a specific product by id', async () => {
    const created = (await createProduct({ name: 'Date', sku: 'DTE001' })).body;
    const res = await request(app).get(`/product/${created._id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Date');
  });
});

describe('POST /product — update', () => {
  it('updates an existing product when id is provided', async () => {
    const created = (await createProduct({ name: 'Elderberry', sku: 'ELD001' })).body;
    const res = await request(app).post('/product').send({
      id: String(created._id), name: 'Elderberry Updated', price: '5.00',
      quantity: '20', stock: '', category: '1', sku: 'ELD001', sort: '0', img: '', remove: '',
    });
    expect(res.status).toBe(200);

    const fetched = await request(app).get(`/product/${created._id}`);
    expect(fetched.body.name).toBe('Elderberry Updated');
    expect(fetched.body.quantity).toBe('20');
  });
});

describe('DELETE /product/:id', () => {
  it('removes the product', async () => {
    const created = (await createProduct({ name: 'Fig', sku: 'FIG001' })).body;
    const del = await request(app).delete(`/product/${created._id}`);
    expect(del.status).toBe(200);

    const fetched = await request(app).get(`/product/${created._id}`);
    expect(fetched.body).not.toHaveProperty('_id');
  });
});

describe('POST /product/sku', () => {
  it('finds a product by numeric id (barcode scan)', async () => {
    const created = (await createProduct({ name: 'Grape', sku: 'GRP001' })).body;
    const res = await request(app).post('/product/sku').send({ skuCode: String(created._id) });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Grape');
  });

  it('finds a product by sku field', async () => {
    await createProduct({ name: 'Honeydew', sku: 'HON001' });
    const res = await request(app).post('/product/sku').send({ skuCode: 'HON001' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Honeydew');
  });

  it('returns null for an unknown barcode', async () => {
    const res = await request(app).post('/product/sku').send({ skuCode: '999999' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('_id');
  });
});

describe('GET /products — sort order', () => {
  it('returns products sorted by sort ASC then _id ASC', async () => {
    await createProduct({ name: 'Z-Product', sku: 'ZZZ', sort: '5' });
    await createProduct({ name: 'A-Product', sku: 'AAA', sort: '1' });
    const res = await request(app).get('/products');
    const names = res.body.map(p => p.name);
    const aIdx = names.indexOf('A-Product');
    const zIdx = names.indexOf('Z-Product');
    expect(aIdx).toBeLessThan(zIdx);
  });
});

// ─── REGRESSION: decrementInventory ─────────────────────────────────────────

describe('REGRESSION: decrementInventory', () => {
  // Bug fixed: previously decremented even when stock == 0 (tracking disabled)
  it('does NOT decrement a product with stock tracking disabled (stock=0)', async () => {
    const created = (await createProduct({
      name: 'Unlimited Item', sku: 'UNL001', stock: 'on', quantity: '0',
    })).body;
    expect(created.stock).toBe(0);

    app.decrementInventory([{ id: created._id, quantity: 3 }]);

    await new Promise(r => setTimeout(r, 500));
    const fetched = await request(app).get(`/product/${created._id}`);
    expect(fetched.body.quantity).toBe('0'); // unchanged
  });

  it('DOES decrement a stock-tracked product (stock=1)', async () => {
    const created = (await createProduct({
      name: 'Tracked Item', sku: 'TRK001', stock: '', quantity: '8',
    })).body;
    expect(created.stock).toBe(1);

    app.decrementInventory([{ id: created._id, quantity: 3 }]);

    await new Promise(r => setTimeout(r, 500));
    const fetched = await request(app).get(`/product/${created._id}`);
    expect(parseInt(fetched.body.quantity)).toBe(5);
  });

  it('handles a missing product gracefully (no crash)', async () => {
    expect(() => {
      app.decrementInventory([{ id: 99999999, quantity: 1 }]);
    }).not.toThrow();
    await new Promise(r => setTimeout(r, 300));
  });
});
