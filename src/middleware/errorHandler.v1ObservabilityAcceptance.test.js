const express = require('express');
const request = require('supertest');
const { errorHandler } = require('./errorHandler');

const makeApp = (error) => {
  const app = express();
  app.get('/boom', (_req, _res, next) => next(error));
  app.use(errorHandler);
  return app;
};

describe('V1 Central client error hygiene', () => {
  test('hides internal 500 error details and infrastructure codes', async () => {
    const error = new Error('password=secret postgresql://admin:secret@db.internal:5432/master');
    error.code = 'ECONNREFUSED';

    const response = await request(makeApp(error)).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Internal Server Error',
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('db.internal');
    expect(serialized).not.toContain('ECONNREFUSED');
  });

  test('preserves explicit client-safe 4xx error code and message', async () => {
    const error = new Error('Requested operation is not allowed');
    error.status = 403;
    error.code = 'FORBIDDEN';

    const response = await request(makeApp(error)).get('/boom');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      code: 'FORBIDDEN',
      message: 'Requested operation is not allowed',
    });
  });

  test('uses stable client-safe defaults for untyped 4xx errors', async () => {
    const error = new Error();
    error.statusCode = 400;

    const response = await request(makeApp(error)).get('/boom');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      code: 'REQUEST_FAILED',
      message: 'Request failed',
    });
  });
});
