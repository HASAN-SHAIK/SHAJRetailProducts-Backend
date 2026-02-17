// require('dotenv').config();
const request = require('supertest');
const pool = require('../src/db'); // DB connection
const app = require('../src/App'); // Adjust path

describe('Auth API Tests', () => {
  const testRunId = Date.now();
  let token;
  const deviceId = `device-${testRunId}`;
  const testUser = {
    name: 'Test User',
    email: `testuser_${testRunId}@example.com`,
    password: 'Test@1234',
    role: 'admin'
  };

  test('should register a new user', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: testUser.name,
      email: testUser.email,
      password: testUser.password,
      role: testUser.role
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('message', 'User registered');
  });

  test('should log in and receive a token', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: testUser.email,
      password: testUser.password,
      device_id: deviceId
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;
  });

  test('should not allow access without token', async () => {
    const res = await request(app).get('/api/products');
    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty('message', 'Access Denied');
  });

  test('should allow access getting products with valid token', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', `token=${token}`)
      .set('x-device-id', deviceId);
    expect(res.statusCode).toBe(200);
  });

  test('Delete the user with valid token', async () => {
    const res = await request(app)
      .delete('/api/auth/delete')
      .set('Cookie', `token=${token}`)
      .set('x-device-id', deviceId)
      .send({
        email: testUser.email
      });
    expect(res.statusCode).toBe(204);
    // expect(res.body).toHaveProperty('message', 'User Deleted');
  });

  afterAll(async () => {
    try {
      await pool.query('DELETE FROM users WHERE email = $1', [testUser.email]);
    } finally {
      await pool.end(); // Close DB connection
    }
    //  await client.end();
  });
});
