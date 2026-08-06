const { buildOrderingKey } = require('../../src/messaging/sync/syncOperation.repository');

describe('syncOperation.repository helpers', () => {
  test('buildOrderingKey is stable per entity', () => {
    const key = buildOrderingKey({
      tenantId: 'tenant-1',
      module: 'sales',
      entityType: 'order',
      entityId: '42',
      clientId: 'client-abc',
    });
    expect(key).toBe('tenant-1:sales:order:42');
  });
});
