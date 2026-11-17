jest.mock('./customer.controller', () => {
  const ok = (status) => (req, res) => res.status(status).json({ success: true });
  const pass = (req, res, next) => next();
  return {
    validateListCustomers: pass,
    validateCustomerId: pass,
    validateCreateCustomer: pass,
    validateUpdateCustomer: pass,
    listCustomers: ok(200),
    getCustomer: ok(200),
    createCustomer: ok(201),
    updateCustomer: ok(200),
    deleteCustomer: ok(200),
  };
});

const express = require('express');
const request = require('supertest');
const router = require('./customer.routes');

const buildApp = (user) => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { if (user) req.user = user; next(); });
  app.use('/customers', router);
  return app;
};
const tenant = (role) => ({ type: 'tenant', role });

// Matrix: expected status per [GET list, GET detail, POST, PUT, DELETE].
// DELETE rule: customers:write AND role admin|manager (staff/cashier denied).
const matrix = {
  admin:   [200, 200, 201, 200, 200],
  manager: [200, 200, 201, 200, 200],
  cashier: [200, 200, 403, 403, 403], // customers:read only, same as legacy routes
  staff:   [200, 200, 201, 200, 403], // can write but may not deactivate
  viewer:  [403, 403, 403, 403, 403], // role with no permissions
};
const calls = [
  ['GET /', (a) => request(a).get('/customers')],
  ['GET /:id', (a) => request(a).get('/customers/1')],
  ['POST /', (a) => request(a).post('/customers').send({ name: 'x' })],
  ['PUT /:id', (a) => request(a).put('/customers/1').send({ name: 'y' })],
  ['DELETE /:id', (a) => request(a).delete('/customers/1')],
];

describe('v1 customer routes RBAC matrix', () => {
  describe.each(Object.entries(matrix))('role %s', (role, expected) => {
    test.each(calls.map((c, i) => [c[0], c[1], expected[i]]))('%s -> %i', async (_n, fn, status) => {
      const res = await fn(buildApp(tenant(role)));
      expect(res.status).toBe(status);
    });
  });

  describe('unauthenticated', () => {
    test.each(calls)('%s -> 401', async (_n, fn) => {
      expect((await fn(buildApp(null))).status).toBe(401);
    });
  });

  test('non-tenant principal is rejected with 401', async () => {
    const res = await request(buildApp({ type: 'platform', role: 'admin' })).get('/customers');
    expect(res.status).toBe(401);
  });
});
