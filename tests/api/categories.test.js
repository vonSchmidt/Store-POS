const { createTestEnv, removeTestEnv } = require('../helpers/db');
const testDir = createTestEnv('cat');
process.env.APPDATA = testDir;

const request = require('supertest');
const app = require('../../api/categories');

afterAll(() => removeTestEnv(testDir));

describe('GET /all', () => {
  it('returns an empty array on fresh database', async () => {
    const res = await request(app).get('/all');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /category', () => {
  it('creates a category', async () => {
    const res = await request(app).post('/category').send({ name: 'Beverages' });
    expect(res.status).toBe(200);
  });

  it('category appears in GET /all', async () => {
    await request(app).post('/category').send({ name: 'Snacks' });
    const res = await request(app).get('/all');
    const names = res.body.map(c => c.name);
    expect(names).toContain('Snacks');
  });

  it('assigns a numeric _id', async () => {
    await request(app).post('/category').send({ name: 'Dairy' });
    const res = await request(app).get('/all');
    const dairy = res.body.find(c => c.name === 'Dairy');
    expect(typeof dairy._id).toBe('number');
  });
});

describe('PUT /category', () => {
  it('renames an existing category', async () => {
    await request(app).post('/category').send({ name: 'Meats' });
    const all = await request(app).get('/all');
    const meats = all.body.find(c => c.name === 'Meats');

    const res = await request(app).put('/category').send({ id: meats._id, name: 'Poultry' });
    expect(res.status).toBe(200);

    const updated = await request(app).get('/all');
    expect(updated.body.find(c => c.name === 'Poultry')).toBeDefined();
    expect(updated.body.find(c => c.name === 'Meats')).toBeUndefined();
  });
});

describe('DELETE /category/:id', () => {
  it('removes the category', async () => {
    await request(app).post('/category').send({ name: 'Bakery' });
    const all = await request(app).get('/all');
    const bakery = all.body.find(c => c.name === 'Bakery');

    const del = await request(app).delete(`/category/${bakery._id}`);
    expect(del.status).toBe(200);

    const after = await request(app).get('/all');
    expect(after.body.find(c => c.name === 'Bakery')).toBeUndefined();
  });
});
