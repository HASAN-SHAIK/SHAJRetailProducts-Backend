const fs = require('fs');
const path = require('path');
const { ensureDeviceRegistration } = require('../src/utils/branchDeviceLicensing');

const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const fakePool = (responses) => {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected query: ${sql}`);
      return next;
    },
  };
};

describe('V1 tenant auth device authority', () => {
  test('login and getLogin validate existing device authority instead of registering it', () => {
    const controller = source('src/controllers/authController.js');
    const validationUses = controller.match(/mode: 'validate'/g) || [];
    expect(validationUses).toHaveLength(2);
    expect(controller).not.toContain("mode: 'register'");
  });

  test('login refuses a POS branch outside the restricted user scope before issuing a session', () => {
    const controller = source('src/controllers/authController.js');
    const forbiddenCheck = controller.indexOf("'POS_DEVICE_BRANCH_FORBIDDEN'");
    const sessionIssue = controller.indexOf('const session = await issueAuthSession({');

    expect(controller).toContain('const hasAllBranchAccess = (user)');
    expect(controller).toContain('normalizeBranchScope(user.branch_id) !== normalizeBranchScope(branchId)');
    expect(forbiddenCheck).toBeGreaterThan(-1);
    expect(sessionIssue).toBeGreaterThan(forbiddenCheck);
  });

  test('validation mode rejects an unknown device without creating authority', async () => {
    const pool = fakePool([
      { rowCount: 1, rows: [{ id: 'branch-1', subscription_plan: 'enterprise', max_devices_allowed: null, is_active: true }] },
      { rowCount: 0, rows: [] },
      { rowCount: 0, rows: [] },
    ]);

    const result = await ensureDeviceRegistration({
      tenantPool: pool,
      branchId: 'branch-1',
      deviceId: 'device-new',
      userId: 7,
      mode: 'validate',
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('DEVICE_NOT_REGISTERED');
    expect(pool.calls.some(({ sql }) => /INSERT INTO branch_devices|UPDATE branch_devices SET is_active/i.test(sql))).toBe(false);
  });

  test('validation mode rejects an inactive device without reactivating it', async () => {
    const pool = fakePool([
      { rowCount: 1, rows: [{ id: 'branch-1', subscription_plan: 'enterprise', max_devices_allowed: null, is_active: true }] },
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ id: 9, is_active: false }] },
    ]);

    const result = await ensureDeviceRegistration({
      tenantPool: pool,
      branchId: 'branch-1',
      deviceId: 'device-revoked',
      userId: 7,
      mode: 'validate',
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('DEVICE_INACTIVE');
    expect(pool.calls.some(({ sql }) => /UPDATE branch_devices SET is_active/i.test(sql))).toBe(false);
  });
});
