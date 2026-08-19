const express = require('express');
const request = require('supertest');
const { requestCorrelationMiddleware, REQUEST_ID_PATTERN } = require('./requestCorrelation');

const createApp = () => {
  const app = express();
  app.use(requestCorrelationMiddleware);
  app.get('/probe', (req, res) => res.status(201).json({ request_id: req.requestId }));
  return app;
};

describe('V1 Central request correlation', () => {
  let infoSpy;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  test('preserves a bounded safe caller request id in the response and request context', async () => {
    const response = await request(createApp())
      .get('/probe')
      .set('X-Request-ID', 'checkout-1234:retry-1');

    expect(response.status).toBe(201);
    expect(response.headers['x-request-id']).toBe('checkout-1234:retry-1');
    expect(response.body).toEqual({ request_id: 'checkout-1234:retry-1' });
  });

  test.each([
    ['too long', 'x'.repeat(129)],
    ['unsafe characters', 'checkout request id'],
  ])('regenerates %s caller request ids instead of reflecting them', async (_label, supplied) => {
    const response = await request(createApp()).get('/probe').set('X-Request-ID', supplied);
    const requestId = response.headers['x-request-id'];

    expect(requestId).toBeTruthy();
    expect(requestId).not.toBe(supplied);
    expect(requestId.length).toBeLessThanOrEqual(128);
    expect(REQUEST_ID_PATTERN.test(requestId)).toBe(true);
    expect(response.body.request_id).toBe(requestId);
  });

  test('generates an id when absent and links the same id to structured completion logging without query secrets', async () => {
    const response = await request(createApp()).get('/probe?token=do-not-log');
    await new Promise((resolve) => setImmediate(resolve));

    const requestId = response.headers['x-request-id'];
    expect(requestId).toBeTruthy();
    expect(REQUEST_ID_PATTERN.test(requestId)).toBe(true);

    const call = infoSpy.mock.calls.find(([event]) => event === 'http_request');
    expect(call).toBeTruthy();
    expect(call[1]).toEqual(expect.objectContaining({
      request_id: requestId,
      method: 'GET',
      path: '/probe',
      status: 201,
    }));
    expect(call[1].duration_ms).toEqual(expect.any(Number));
    expect(JSON.stringify(call[1])).not.toContain('do-not-log');
  });
});
