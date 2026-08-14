jest.mock('../src/configuration/schema', () => ({
  ensureConfigurationSchema: jest.fn(async () => {}),
}));

jest.mock('../src/configuration/readRepository', () => ({
  readLegacyTenantValues: jest.fn(async () => ({})),
  readScopeLayer: jest.fn(async (_pool, scopeType, scopeId) => {
    const empty = { scopeType, scopeId, values: {}, revisions: {} };
    if (!scopeId) return empty;
    if (scopeType === 'tenant' && scopeId === 'tenant-a') {
      return { scopeType, scopeId, values: { 'tax.gst_enabled': false }, revisions: { 'tax.gst_enabled': 2 } };
    }
    if (scopeType === 'branch' && scopeId === 'branch-a') {
      return { scopeType, scopeId, values: { 'tax.gst_mode': 'EXCLUSIVE' }, revisions: { 'tax.gst_mode': 3 } };
    }
    if (scopeType === 'tenant' && scopeId === 'tenant-b') {
      return { scopeType, scopeId, values: { 'tax.gst_enabled': true }, revisions: { 'tax.gst_enabled': 7 } };
    }
    if (scopeType === 'branch' && scopeId === 'branch-b') {
      return { scopeType, scopeId, values: { 'tax.gst_mode': 'INCLUSIVE' }, revisions: { 'tax.gst_mode': 8 } };
    }
    return empty;
  }),
  readAudit: jest.fn(async () => []),
}));

jest.mock('../src/configuration/targets', () => ({
  getRequestPool: jest.fn((req) => req.pool),
  getTenantScopeId: jest.fn((req) => req.tenant.id),
  resolveBranch: jest.fn(async (_pool, branchId) => branchId),
  resolveDevice: jest.fn(async (_pool, deviceId) => {
    if (deviceId === 'device-a') return { deviceId, branchId: 'branch-a', active: true };
    if (deviceId === 'device-b') return { deviceId, branchId: 'branch-b', active: true };
    return null;
  }),
  resolveTarget: jest.fn(),
}));

jest.mock('../src/configuration/writeRepository', () => ({
  upsertLegacySetting: jest.fn(),
  recordAuditChange: jest.fn(),
  writeGenericOverride: jest.fn(),
  removeGenericOverride: jest.fn(),
}));

jest.mock('../src/db/masterPool', () => ({ query: jest.fn() }));

const { resolveEffectiveConfiguration } = require('../src/configuration/service');

describe('V1 pricing/tax effective policy isolation', () => {
  test('keeps tenant and registered-device branch tax policy isolated', async () => {
    const pool = {};
    const tenantA = await resolveEffectiveConfiguration(
      { pool, tenant: { id: 'tenant-a' } },
      { deviceId: 'device-a', requireRegisteredDevice: true }
    );
    const tenantB = await resolveEffectiveConfiguration(
      { pool, tenant: { id: 'tenant-b' } },
      { deviceId: 'device-b', requireRegisteredDevice: true }
    );

    expect(tenantA.scope).toMatchObject({
      tenant_id: 'tenant-a',
      branch_id: 'branch-a',
      device_id: 'device-a',
      device_registered: true,
    });
    expect(tenantA.config.tax).toMatchObject({
      gst_enabled: false,
      gst_mode: 'EXCLUSIVE',
      rounding_mode: 'HALF_UP',
    });
    expect(tenantA.sources['tax.gst_enabled']).toEqual({ scope_type: 'tenant', scope_id: 'tenant-a', revision: 2 });
    expect(tenantA.sources['tax.gst_mode']).toEqual({ scope_type: 'branch', scope_id: 'branch-a', revision: 3 });

    expect(tenantB.scope).toMatchObject({
      tenant_id: 'tenant-b',
      branch_id: 'branch-b',
      device_id: 'device-b',
      device_registered: true,
    });
    expect(tenantB.config.tax).toMatchObject({
      gst_enabled: true,
      gst_mode: 'INCLUSIVE',
      rounding_mode: 'HALF_UP',
    });
    expect(tenantB.sources['tax.gst_enabled']).toEqual({ scope_type: 'tenant', scope_id: 'tenant-b', revision: 7 });
    expect(tenantB.sources['tax.gst_mode']).toEqual({ scope_type: 'branch', scope_id: 'branch-b', revision: 8 });

    expect(tenantA.etag).not.toBe(tenantB.etag);
  });

  test('rejects an unregistered POS device when registration is required', async () => {
    await expect(resolveEffectiveConfiguration(
      { pool: {}, tenant: { id: 'tenant-a' } },
      { deviceId: 'unknown-device', requireRegisteredDevice: true }
    )).rejects.toMatchObject({ status: 403, code: 'POS_DEVICE_NOT_REGISTERED' });
  });
});
