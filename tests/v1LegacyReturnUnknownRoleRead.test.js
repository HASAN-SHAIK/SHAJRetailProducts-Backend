const { requirePermission } = require('../src/middleware/requirePermission');

const runGuard = (role) => {
  const state = { status: 200, body: null, nextCalled: false };
  const res = {
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; },
  };
  requirePermission('orders:read')(
    { user: { type: 'tenant', role } },
    res,
    () => { state.nextCalled = true; }
  );
  return state;
};

describe('V1 legacy return history unknown-role authorization', () => {
  test('unrecognized authenticated tenant role fails closed for orders:read', () => {
    const result = runGuard('auditor');
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      success: false,
      code: 'FORBIDDEN',
      message: 'Missing required permission: orders:read',
    });
  });
});
