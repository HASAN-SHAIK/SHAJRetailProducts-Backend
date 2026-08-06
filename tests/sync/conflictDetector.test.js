const {
  isConflictError,
  buildConflictError,
  extractSourceVersion,
} = require('../../src/messaging/sync/conflictDetector');
const { detectTimestampConflict } = require('../../src/messaging/sync/conflictResolver');

describe('conflictDetector', () => {
  test('extractSourceVersion reads sync_version', () => {
    expect(extractSourceVersion({ sync_version: 3 })).toBe(3);
    expect(extractSourceVersion({ version_number: 2 })).toBe(2);
    expect(extractSourceVersion({})).toBeNull();
  });

  test('buildConflictError sets code', () => {
    const error = buildConflictError({
      reason: 'last_modified',
      entityType: 'product',
      entityId: '55',
      serverUpdatedAt: new Date('2026-07-12T12:00:00.000Z'),
      sourceUpdatedAt: new Date('2026-07-12T11:00:00.000Z'),
    });
    expect(error.code).toBe('SYNC_CONFLICT');
    expect(isConflictError(error)).toBe(true);
  });

  test('detectTimestampConflict returns conflict for stale client payload', async () => {
    const tenantPool = {
      query: async () => ({
        rows: [{ id: 1, updated_at: '2026-07-12T12:00:00.000Z', is_deleted: false }],
      }),
    };

    const conflict = await detectTimestampConflict({
      tenantPool,
      module: 'sales',
      entityType: 'order',
      entityId: '1',
      action: 'UPDATE',
      payload: { updated_at: '2026-07-12T11:00:00.000Z' },
    });

    expect(conflict).toBeTruthy();
    expect(isConflictError(conflict)).toBe(true);
  });
});
