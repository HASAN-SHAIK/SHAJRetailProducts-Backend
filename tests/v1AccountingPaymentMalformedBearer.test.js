const { authTenantMiddleware } = require('../src/middleware/authTenant');

describe('V1 accounting payment malformed bearer authorization', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'cycle-a-accounting-payment-test-secret';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  test('malformed bearer fails closed before tenant resolution or financial mutation', async () => {
    const state = { status: 200, body: null, nextCalled: false };
    const req = {
      headers: { authorization: 'Bearer definitely-not-a-jwt' },
      cookies: {},
    };
    const res = {
      status(code) { state.status = code; return this; },
      json(body) { state.body = body; return this; },
    };

    await authTenantMiddleware(req, res, () => { state.nextCalled = true; });

    expect(state.nextCalled).toBe(false);
    expect(state.status).toBe(401);
    expect(state.body).toEqual({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Invalid token',
    });
    expect(req.tenantPool).toBeUndefined();
  });
});
