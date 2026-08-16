const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mockResolveDevice = jest.fn();

jest.mock('../configuration/targets', () => ({
  resolveDevice: (...args) => mockResolveDevice(...args),
}));

const { issueOfflineGrant } = require('./offlineGrantController');
const { getPermissionsForRole } = require('../utils/rolePermissions');

const responseMock = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const currentUser = (overrides = {}) => ({
  id: 44,
  role: 'cashier',
  branch_id: 'store-1',
  all_branch_access: false,
  ...overrides,
});

const tenantPoolFor = (row = currentUser()) => ({
  query: jest.fn().mockResolvedValue(row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] }),
});

const baseRequest = (overrides = {}) => ({
  body: { device_id: 'device-1' },
  tenantPool: tenantPoolFor(),
  user: {
    user_id: '44',
    tenant_id: 'tenant-1',
    role: 'cashier',
    branch_id: 'store-1',
    all_branch_access: false,
    permissions: ['stale:claim:must:not:be:used'],
  },
  ...overrides,
});

describe('offline POS grant issuer', () => {
  let privateKey;
  let publicKey;

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  beforeEach(() => {
    process.env.POS_OFFLINE_GRANT_PRIVATE_KEY = privateKey;
    process.env.POS_OFFLINE_GRANT_EXPIRY = '1h';
    process.env.POS_OFFLINE_GRANT_KEY_ID = 'test-key-v1';
    mockResolveDevice.mockResolvedValue({
      id: 'registration-1',
      deviceId: 'device-1',
      branchId: 'store-1',
      active: true,
    });
  });

  afterEach(() => {
    delete process.env.POS_OFFLINE_GRANT_PRIVATE_KEY;
    delete process.env.POS_OFFLINE_GRANT_EXPIRY;
    delete process.env.POS_OFFLINE_GRANT_KEY_ID;
    jest.clearAllMocks();
  });

  test('signs a grant from current Central user authority and the active trusted device branch', async () => {
    const req = baseRequest();
    const res = responseMock();

    await issueOfflineGrant(req, res);

    expect(req.tenantPool.query).toHaveBeenCalledWith(expect.stringContaining('FROM users'), ['44']);
    expect(mockResolveDevice).toHaveBeenCalledWith(req.tenantPool, 'device-1', { requireActive: true });
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ device_id: 'device-1', branch_id: 'store-1' });
    const header = jwt.decode(payload.offline_grant, { complete: true }).header;
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe('test-key-v1');

    const claims = jwt.verify(payload.offline_grant, publicKey, {
      algorithms: ['RS256'], issuer: 'shajtech-central', audience: 'shajtech-pos-edge',
    });
    expect(claims).toMatchObject({
      type: 'pos_offline_grant', user_id: '44', tenant_id: 'tenant-1', role: 'cashier',
      device_id: 'device-1', branch_id: 'store-1', all_branch_access: false,
      permissions: getPermissionsForRole('cashier'),
      store_permissions: { branch_id: 'store-1', all_branch_access: false },
    });
    expect(claims.permissions).not.toContain('stale:claim:must:not:be:used');
    expect(claims.grant_id).toBeTruthy();
  });

  test('stale manager access JWT cannot mint a new manager offline grant after Central downgrade', async () => {
    const req = baseRequest({
      tenantPool: tenantPoolFor(currentUser({ role: 'cashier' })),
      user: {
        user_id: '44', tenant_id: 'tenant-1', role: 'manager', branch_id: 'store-1',
        all_branch_access: false, permissions: ['*'],
      },
    });
    const res = responseMock();

    await issueOfflineGrant(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const claims = jwt.verify(res.json.mock.calls[0][0].offline_grant, publicKey, {
      algorithms: ['RS256'], issuer: 'shajtech-central', audience: 'shajtech-pos-edge',
    });
    expect(claims.role).toBe('cashier');
    expect(claims.permissions).toEqual(expect.arrayContaining(getPermissionsForRole('cashier')));
    expect(claims.permissions).not.toContain('*');
    expect(claims.permissions).not.toContain('pos:refund');
  });

  test('stale old-branch JWT cannot mint a grant after Central branch reassignment', async () => {
    const req = baseRequest({
      tenantPool: tenantPoolFor(currentUser({ branch_id: 'store-2' })),
      user: {
        user_id: '44', tenant_id: 'tenant-1', role: 'cashier', branch_id: 'store-1',
        all_branch_access: false, permissions: getPermissionsForRole('cashier'),
      },
    });
    const res = responseMock();

    await issueOfflineGrant(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('POS_DEVICE_BRANCH_FORBIDDEN');
  });

  test('narrows a current all-branch administrator grant to the target POS branch', async () => {
    const req = baseRequest({
      body: { device_id: 'device-2' },
      tenantPool: tenantPoolFor(currentUser({ id: 1, role: 'admin', branch_id: null, all_branch_access: true })),
      user: {
        user_id: '1', tenant_id: 'tenant-1', role: 'admin', branch_id: null,
        all_branch_access: true, permissions: ['*'],
      },
    });
    mockResolveDevice.mockResolvedValue({ id: 'registration-2', deviceId: 'device-2', branchId: 'store-2', active: true });
    const res = responseMock();

    await issueOfflineGrant(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const claims = jwt.verify(res.json.mock.calls[0][0].offline_grant, publicKey, {
      algorithms: ['RS256'], issuer: 'shajtech-central', audience: 'shajtech-pos-edge',
    });
    expect(claims).toMatchObject({ role: 'admin', branch_id: 'store-2', all_branch_access: false, permissions: ['*'] });
  });

  test('rejects a removed or unsupported current Central user', async () => {
    const removed = responseMock();
    await issueOfflineGrant(baseRequest({ tenantPool: tenantPoolFor(null) }), removed);
    expect(removed.status).toHaveBeenCalledWith(403);
    expect(removed.json.mock.calls[0][0].code).toBe('OFFLINE_GRANT_USER_FORBIDDEN');

    const invalidRole = responseMock();
    await issueOfflineGrant(baseRequest({ tenantPool: tenantPoolFor(currentUser({ role: 'unknown' })) }), invalidRole);
    expect(invalidRole.status).toHaveBeenCalledWith(403);
    expect(invalidRole.json.mock.calls[0][0].code).toBe('OFFLINE_GRANT_USER_FORBIDDEN');
  });

  test('rejects an unregistered or revoked POS device', async () => {
    mockResolveDevice.mockResolvedValue(null);
    const res = responseMock();

    await issueOfflineGrant(baseRequest(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('POS_DEVICE_NOT_REGISTERED');
  });

  test('rejects a device outside the current restricted user branch', async () => {
    mockResolveDevice.mockResolvedValue({ id: 'registration-2', deviceId: 'device-2', branchId: 'store-2', active: true });
    const res = responseMock();

    await issueOfflineGrant(baseRequest({ body: { device_id: 'device-2' } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('POS_DEVICE_BRANCH_FORBIDDEN');
  });

  test('requires a target device for offline authorization', async () => {
    const res = responseMock();
    await issueOfflineGrant(baseRequest({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('fails closed when Central signing key is not configured', async () => {
    delete process.env.POS_OFFLINE_GRANT_PRIVATE_KEY;
    const res = responseMock();
    await issueOfflineGrant(baseRequest(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(mockResolveDevice).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].code).toBe('OFFLINE_GRANT_DISABLED');
  });
});
