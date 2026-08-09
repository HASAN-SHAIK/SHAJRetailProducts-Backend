const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { issuePosSyncRecoveryGrant } = require('./posSyncRecoveryGrantController');

const responseMock = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('POS sync recovery grant issuer', () => {
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
    process.env.POS_OFFLINE_GRANT_KEY_ID = 'test-key-v1';
    process.env.POS_SYNC_RECOVERY_GRANT_EXPIRY = '10m';
  });

  afterEach(() => {
    delete process.env.POS_OFFLINE_GRANT_PRIVATE_KEY;
    delete process.env.POS_OFFLINE_GRANT_KEY_ID;
    delete process.env.POS_SYNC_RECOVERY_GRANT_EXPIRY;
  });

  test('issues a short-lived Central-signed grant bound to manager, device, order and dead-letter event', async () => {
    const req = {
      body: {
        device_id: 'device-1',
        order_id: 'ord-1',
        event_id: 'evt-dead-letter-1',
        reason: 'Reviewed outage and approved retry',
      },
      user: { user_id: 'manager-44', tenant_id: 'tenant-1', role: 'manager' },
    };
    const res = responseMock();

    await issuePosSyncRecoveryGrant(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    const claims = jwt.verify(response.recovery_grant, publicKey, {
      algorithms: ['RS256'],
      issuer: 'shajtech-central',
      audience: 'shajtech-pos-edge',
    });
    expect(claims).toMatchObject({
      type: 'pos_sync_recovery_grant',
      tenant_id: 'tenant-1',
      device_id: 'device-1',
      order_id: 'ord-1',
      ordering_key: 'sales_order:ord-1',
      event_id: 'evt-dead-letter-1',
      approved_by_user_id: 'manager-44',
      reason: 'Reviewed outage and approved retry',
    });
    expect(claims.recovery_id).toBeTruthy();
    expect(response.recovery_id).toBe(claims.recovery_id);
  });

  test('rejects cashier recovery authorization', async () => {
    const res = responseMock();
    await issuePosSyncRecoveryGrant({
      body: { device_id: 'device-1', order_id: 'ord-1', event_id: 'evt-1', reason: 'retry' },
      user: { user_id: 'cashier-1', tenant_id: 'tenant-1', role: 'cashier' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('requires exact recovery context before signing', async () => {
    const res = responseMock();
    await issuePosSyncRecoveryGrant({
      body: { device_id: 'device-1', order_id: 'ord-1', reason: 'retry' },
      user: { user_id: 'manager-44', tenant_id: 'tenant-1', role: 'manager' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('fails closed when Central signing key is unavailable', async () => {
    delete process.env.POS_OFFLINE_GRANT_PRIVATE_KEY;
    const res = responseMock();
    await issuePosSyncRecoveryGrant({
      body: { device_id: 'device-1', order_id: 'ord-1', event_id: 'evt-1', reason: 'retry' },
      user: { user_id: 'manager-44', tenant_id: 'tenant-1', role: 'manager' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
