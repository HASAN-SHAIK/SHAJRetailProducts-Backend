const request = require('supertest');
const app = require('../src/App');

describe('V1 accounting bank-book authorization', () => {
  test('unauthenticated real application route fails closed before accounting data access', async () => {
    const response = await request(app)
      .get('/api/accounts/bank-book')
      .expect(401);

    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body).toEqual({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    });
  });
});
