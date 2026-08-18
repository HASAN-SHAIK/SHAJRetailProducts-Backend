const { runFleetMigration, runStatements } = require('./runTenantMigration');

const silentLogger = { log: jest.fn(), error: jest.fn() };
const migrationSQL = 'ALTER TABLE example ADD COLUMN value INTEGER;';
const migrationMeta = { migrationKey: '2026-08-19-example.sql', migrationChecksum: 'checksum-v1' };

const makeClient = ({ failSql = false, existingChecksum = null } = {}) => {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql) => {
      queries.push(sql);
      if (String(sql).startsWith('SELECT checksum FROM tenant_schema_migrations')) {
        return { rows: existingChecksum ? [{ checksum: existingChecksum }] : [] };
      }
      if (failSql && sql === migrationSQL) {
        throw new Error('synthetic migration failure');
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
};

const expectHistoryBoundary = (queries) => {
  expect(queries[0]).toBe('BEGIN');
  expect(queries[1]).toBe('SET LOCAL search_path TO public');
  expect(queries.some((query) => String(query).includes('CREATE TABLE IF NOT EXISTS tenant_schema_migrations'))).toBe(true);
  expect(queries.some((query) => String(query).startsWith('SELECT checksum FROM tenant_schema_migrations'))).toBe(true);
};

describe('V1 database quality tenant migration runner', () => {
  beforeEach(() => jest.clearAllMocks());

  test('applies and records each tenant migration atomically inside BEGIN/COMMIT', async () => {
    const client = makeClient();
    const pool = { connect: jest.fn(async () => client) };

    const result = await runStatements(pool, 'tenant-a', migrationSQL, migrationMeta);

    expect(result).toEqual({ tenant: 'tenant-a', status: 'applied' });
    expectHistoryBoundary(client.queries);
    expect(client.queries).toContain(migrationSQL);
    expect(client.queries.some((query) => String(query).startsWith('INSERT INTO tenant_schema_migrations'))).toBe(true);
    expect(client.queries.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rerun with the same migration checksum is skipped without duplicate schema work', async () => {
    const client = makeClient({ existingChecksum: migrationMeta.migrationChecksum });
    const pool = { connect: jest.fn(async () => client) };

    const result = await runStatements(pool, 'tenant-a', migrationSQL, migrationMeta);

    expect(result).toEqual({ tenant: 'tenant-a', status: 'skipped' });
    expectHistoryBoundary(client.queries);
    expect(client.queries).not.toContain(migrationSQL);
    expect(client.queries.some((query) => String(query).startsWith('INSERT INTO tenant_schema_migrations'))).toBe(false);
    expect(client.queries.at(-1)).toBe('COMMIT');
  });

  test('historical migration checksum drift fails closed and rolls back', async () => {
    const client = makeClient({ existingChecksum: 'different-checksum' });
    const pool = { connect: jest.fn(async () => client) };

    await expect(runStatements(pool, 'tenant-a', migrationSQL, migrationMeta)).rejects.toMatchObject({
      code: 'TENANT_MIGRATION_CHECKSUM_MISMATCH',
    });

    expectHistoryBoundary(client.queries);
    expect(client.queries).not.toContain(migrationSQL);
    expect(client.queries.at(-1)).toBe('ROLLBACK');
  });

  test('rolls back a failed tenant migration and never records or commits it', async () => {
    const client = makeClient({ failSql: true });
    const pool = { connect: jest.fn(async () => client) };

    await expect(runStatements(pool, 'tenant-a', migrationSQL, migrationMeta)).rejects.toThrow(
      'synthetic migration failure'
    );

    expectHistoryBoundary(client.queries);
    expect(client.queries).toContain(migrationSQL);
    expect(client.queries.some((query) => String(query).startsWith('INSERT INTO tenant_schema_migrations'))).toBe(false);
    expect(client.queries.at(-1)).toBe('ROLLBACK');
    expect(client.queries).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('collects fleet failures but fails the overall migration after attempting all selected tenants', async () => {
    const tenantClients = {
      'tenant-a': makeClient(),
      'tenant-b': makeClient({ failSql: true }),
      'tenant-c': makeClient(),
    };
    const ended = [];

    class MockPool {
      constructor({ connectionString }) {
        this.connectionString = connectionString;
      }

      async query() {
        if (this.connectionString === 'postgres://master') {
          return {
            rows: [
              { database_name: 'tenant-a' },
              { database_name: 'tenant-b' },
              { database_name: 'tenant-c' },
            ],
          };
        }
        throw new Error('unexpected direct tenant pool query');
      }

      async connect() {
        const dbName = this.connectionString.replace('postgres://', '');
        return tenantClients[dbName];
      }

      async end() {
        ended.push(this.connectionString);
      }
    }

    await expect(
      runFleetMigration({
        masterUrl: 'postgres://master',
        template: 'postgres://{db}',
        sql: migrationSQL,
        ...migrationMeta,
        PoolImpl: MockPool,
        logger: silentLogger,
      })
    ).rejects.toMatchObject({
      code: 'TENANT_MIGRATION_PARTIAL_FAILURE',
      applied: ['tenant-a', 'tenant-c'],
      skipped: [],
      failures: [
        expect.objectContaining({ tenant: 'tenant-b', error: 'synthetic migration failure' }),
      ],
    });

    expect(tenantClients['tenant-a'].queries).toContain('COMMIT');
    expect(tenantClients['tenant-b'].queries).toContain('ROLLBACK');
    expect(tenantClients['tenant-c'].queries).toContain('COMMIT');
    expect(ended).toEqual(
      expect.arrayContaining([
        'postgres://master',
        'postgres://tenant-a',
        'postgres://tenant-b',
        'postgres://tenant-c',
      ])
    );
  });

  test('tenant filter cannot migrate an unselected tenant', async () => {
    const tenantClient = makeClient();

    class MockPool {
      constructor({ connectionString }) {
        this.connectionString = connectionString;
      }

      async query() {
        return {
          rows: [
            { database_name: 'tenant-a' },
            { database_name: 'tenant-b' },
          ],
        };
      }

      async connect() {
        return tenantClient;
      }

      async end() {}
    }

    const result = await runFleetMigration({
      masterUrl: 'postgres://master',
      template: 'postgres://{db}',
      tenantFilter: 'tenant-b',
      sql: 'SELECT 1;',
      migrationKey: '2026-08-19-filter.sql',
      migrationChecksum: 'checksum-filter',
      PoolImpl: MockPool,
      logger: silentLogger,
    });

    expect(result.applied).toEqual(['tenant-b']);
    expect(result.skipped).toEqual([]);
  });
});
