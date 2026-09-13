const isAdmin = require('../src/middleware/isAdmin');

describe('V1 accounting receipt creation authorization', () => {
  test('admin-only mutation fails closed when tenant identity is absent', () => {
    const state = { status: 200, body: null, nextCalled: false };
    const req = { headers: {} };
    const res = {
      status(code) { state.status = code; return this; },
      json(body) { state.body = body; return this; },
    };

    isAdmin(req, res, () => { state.nextCalled = true; });

    expect(state.nextCalled).toBe(false);
    expect(state.status).toBe(401);
    expect(state.body).toEqual({
      error: 'Access Denied. No token provided.',
    });
  });
});
