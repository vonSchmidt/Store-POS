const { createTestEnv, removeTestEnv } = require('../helpers/db');
const testDir = createTestEnv('usr');
process.env.APPDATA = testDir;

const request = require('supertest');
const app = require('../../api/users');

afterAll(() => removeTestEnv(testDir));

// ─── /check — default admin seed ─────────────────────────────────────────────

describe('GET /check', () => {
  it('creates the default admin user (id=1) when database is empty', async () => {
    await request(app).get('/check');
    // Give NeDB insert time to complete
    await new Promise(r => setTimeout(r, 300));
    const res = await request(app).get('/user/1');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('admin');
    expect(res.body._id).toBe(1);
  });

  it('does not duplicate the admin user on repeated calls', async () => {
    await request(app).get('/check');
    await request(app).get('/check');
    await new Promise(r => setTimeout(r, 300));
    const res = await request(app).get('/all');
    const admins = res.body.filter(u => u._id === 1);
    expect(admins.length).toBe(1);
  });
});

// ─── login ───────────────────────────────────────────────────────────────────

describe('POST /login', () => {
  beforeAll(async () => {
    // Ensure admin exists
    await request(app).get('/check');
    await new Promise(r => setTimeout(r, 300));
  });

  it('returns the user object on correct credentials', async () => {
    const res = await request(app).post('/login').send({ username: 'admin', password: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(1);
    expect(res.body.username).toBe('admin');
  });

  it('returns null on wrong password', async () => {
    const res = await request(app).post('/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('_id');
  });

  it('returns null for a non-existent user', async () => {
    const res = await request(app).post('/login').send({ username: 'ghost', password: 'ghost' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('_id');
  });
});

// ─── user management ─────────────────────────────────────────────────────────

describe('POST /post — create user', () => {
  it('creates a new user with all permissions', async () => {
    const res = await request(app).post('/post').send({
      id: '', fullname: 'Jane Smith', username: 'jane',
      password: 'pass123',
      perm_products: 'on', perm_categories: 'on',
      perm_transactions: 'on', perm_users: 'on', perm_settings: 'on',
    });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('jane');
    expect(res.body.perm_products).toBe(1);
  });

  it('creates a user with no permissions', async () => {
    const res = await request(app).post('/post').send({
      id: '', fullname: 'Cashier Only', username: 'cashier',
      password: 'cashier',
      perm_products: '', perm_categories: '', perm_transactions: '',
      perm_users: '', perm_settings: '',
    });
    expect(res.status).toBe(200);
    expect(res.body.perm_products).toBe(0);
    expect(res.body.perm_users).toBe(0);
  });

  it('stores password as base64', async () => {
    const res = await request(app).post('/post').send({
      id: '', fullname: 'Bob', username: 'bob', password: 'mypassword',
      perm_products: '', perm_categories: '', perm_transactions: '',
      perm_users: '', perm_settings: '',
    });
    expect(res.body.password).toBe(Buffer.from('mypassword').toString('base64'));
  });
});

describe('GET /all', () => {
  it('returns all users as an array', async () => {
    const res = await request(app).get('/all');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /post — update user', () => {
  it('updates an existing user fullname', async () => {
    const created = (await request(app).post('/post').send({
      id: '', fullname: 'Old Name', username: 'updatable',
      password: 'pw', perm_products: '', perm_categories: '',
      perm_transactions: '', perm_users: '', perm_settings: '',
    })).body;

    await request(app).post('/post').send({
      id: String(created._id), fullname: 'New Name', username: 'updatable',
      password: 'pw', perm_products: 'on', perm_categories: '',
      perm_transactions: '', perm_users: '', perm_settings: '',
    });

    const fetched = await request(app).get(`/user/${created._id}`);
    expect(fetched.body.fullname).toBe('New Name');
    expect(fetched.body.perm_products).toBe(1);
  });
});

describe('DELETE /user/:id', () => {
  it('removes the user', async () => {
    const created = (await request(app).post('/post').send({
      id: '', fullname: 'Temp User', username: 'temp',
      password: 'pw', perm_products: '', perm_categories: '',
      perm_transactions: '', perm_users: '', perm_settings: '',
    })).body;

    const del = await request(app).delete(`/user/${created._id}`);
    expect(del.status).toBe(200);

    const fetched = await request(app).get(`/user/${created._id}`);
    expect(fetched.body).not.toHaveProperty('_id');
  });
});

describe('GET /logout/:id', () => {
  it('updates user status to Logged Out', async () => {
    const res = await request(app).get('/logout/1');
    expect(res.status).toBe(200);
  });
});
