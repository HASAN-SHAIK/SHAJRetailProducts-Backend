const { runFleetMigration, runStatements } = require('./runTenantMigration');

const silentLogger = { log: jest.fn(), error: jest.fn() };

const makeClient = ({ failSql = false } = {}) => {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql) => {
      queries.push(sql);
      if (failSql && sql === 'ALTER TABLE example ADD COLUMN value INTEGER;') {
        throw new Error('synthetic migration failure');
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
};

describe('V1 database quality tenant migration runner', () => {
  beforeEach(() => jest.clearAllMocks());

  test('applies each tenant migration atomically inside BEGIN/COMMIT', async () => {
    const client = makeClient();
    const pool = { connect: jest.fn(async () => client) };

    await runStatements(pool, 'tenant-a', 'ALTER TABLE example ADD COLUMN value INTEGER;');

    expect(client.queries).toEqual([
      'BEGIN',
      'SET LOCAL search_path TO public',
      'ALTER TABLE example ADD COLUMN value INTEGER;',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back a failed tenant migration and never commits it', async () => {
    const client = makeClient({ failSql: true });
    const pool = { connect: jest.fn(async () => client) };

    await expect(
      runStatements(pool, 'tenant-a', 'ALTER TABLE example ADD COLUMN value INTEGER;')
    ).rejects.toThrow('synthetic migration failure');

    expect(client.queries).toEqual([
      'BEGIN',
      'SET LOCAL search_path TO public',
      'ALTER TABLE example ADD COLUMN value INTEGER;',
      'ROLLBACK',
    ]);
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
        sql: 'ALTER TABLE example ADD COLUMN value INTEGER;',
        PoolImpl: MockPool,
        logger: silentLogger,
      })
    ).rejects.toMatchObject({
      code: 'TENANT_MIGRATION_PARTIAL_FAILURE',
      applied: ['tenant-a', 'tenant-c'],
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
      PoolImpl: MockPool,
      logger: silentLogger,
    });

    expect(result.applied).toEqual(['tenant-b']);
  });
});
