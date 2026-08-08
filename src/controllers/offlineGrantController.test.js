const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { issueOfflineGrant } = require('./offlineGrantController');

const responseMock = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

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
  });

  afterEach(() => {
    delete process.env.POS_OFFLINE_GRANT_PRIVATE_KEY;
    delete process.env.POS_OFFLINE_GRANT_EXPIRY;
    delete process.env.POS_OFFLINE_GRANT_KEY_ID;
  });

  test('signs a device-bound POS grant that only the Central public key verifies', async () => {
    const req = {
      body: { device_id: 'device-1' },
      user: {
        user_id: '44', tenant_id: 'tenant-1', role: 'cashier', branch_id: 'store-1',
        all_branch_access: false,
        permissions: ['products:read', 'orders:read', 'orders:write'],
        store_permissions: { stores: ['store-1'] },
      },
    };
    const res = responseMock();

    await issueOfflineGrant(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.device_id).toBe('device-1');
    const header = jwt.decode(payload.offline_grant, { complete: true }).header;
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe('test-key-v1');

    const claims = jwt.verify(payload.offline_grant, publicKey, {
      algorithms: ['RS256'], issuer: 'shajtech-central', audience: 'shajtech-pos-edge',
    });
    expect(claims).toMatchObject({
      type: 'pos_offline_grant', user_id: '44', tenant_id: 'tenant-1', role: 'cashier',
      device_id: 'device-1', branch_id: 'store-1', all_branch_access: false,
      permissions: ['products:read', 'orders:read', 'orders:write'],
    });
    expect(claims.grant_id).toBeTruthy();
  });

  test('requires a target device for offline authorization', async () => {
    const res = responseMock();
    await issueOfflineGrant({ body: {}, user: { user_id: '44', tenant_id: 'tenant-1', role: 'cashier' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('fails closed when Central signing key is not configured', async () => {
    delete process.env.POS_OFFLINE_GRANT_PRIVATE_KEY;
    const res = responseMock();
    await issueOfflineGrant({ body: { device_id: 'device-1' }, user: { user_id: '44', tenant_id: 'tenant-1', role: 'cashier' } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
