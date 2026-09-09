const { requirePermission } = require('../src/middleware/requirePermission');

describe('V1 accounting payment authorization', () => {
  test('reports:read fails closed when tenant identity is absent', () => {
    const state = { status: 200, body: null, nextCalled: false };
    const res = {
      status(code) { state.status = code; return this; },
      json(body) { state.body = body; return this; },
    };

    requirePermission('reports:read')(
      {},
      res,
      () => { state.nextCalled = true; }
    );

    expect(state.nextCalled).toBe(false);
    expect(state.status).toBe(401);
    expect(state.body).toEqual({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    });
  });
});
