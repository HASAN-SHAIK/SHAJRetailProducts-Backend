const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const { runStatements } = require('./runTenantMigration');
const { getFreshTenantOverlayPaths } = require('../src/services/tenantProvisionService');

const connectionString = process.env.TEST_EXISTING_TENANT_DATABASE_URL;
const describeIfPostgres = connectionString ? describe : describe.skip;

const checksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex');

describeIfPostgres('V1 representative existing-tenant PostgreSQL upgrade', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const baselinePath = path.join(process.cwd(), 'Db', 'tenant_schema.sql');
    await pool.query(fs.readFileSync(baselinePath, 'utf8'));
    await pool.query('CREATE TABLE IF NOT EXISTS v1_upgrade_probe (id BIGINT PRIMARY KEY, value TEXT NOT NULL)');
    await pool.query("INSERT INTO v1_upgrade_probe(id, value) VALUES (1, 'legacy-durable-fact') ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value");
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('applies the ordered V1 overlays through production migration transaction/history semantics and preserves existing data', async () => {
    const overlayPaths = getFreshTenantOverlayPaths();
    const applied = [];

    for (const migrationPath of overlayPaths) {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      const migrationKey = path.basename(migrationPath);
      const result = await runStatements(pool, 'existing_tenant_v1', sql, {
        migrationKey,
        migrationChecksum: checksum(sql),
      });
      expect(result.status).toBe('applied');
      applied.push(migrationKey);
    }

    const history = await pool.query(
      'SELECT migration_key FROM tenant_schema_migrations ORDER BY applied_at ASC, migration_key ASC'
    );
    expect(new Set(history.rows.map((row) => row.migration_key))).toEqual(new Set(applied));

    const probe = await pool.query('SELECT value FROM v1_upgrade_probe WHERE id = 1');
    expect(probe.rows).toEqual([{ value: 'legacy-durable-fact' }]);

    const certifiedFacts = await pool.query(`
      SELECT
        to_regclass('public.pos_inventory_batch_allocations')::text AS batch_allocations,
        to_regclass('public.pos_customer_mappings')::text AS customer_mappings,
        to_regprocedure('recompute_customer_outstanding(bigint)')::text AS outstanding_fn
    `);
    expect(certifiedFacts.rows[0].batch_allocations).toBe('pos_inventory_batch_allocations');
    expect(certifiedFacts.rows[0].customer_mappings).toBe('pos_customer_mappings');
    expect(certifiedFacts.rows[0].outstanding_fn).toBeTruthy();

    const categoryColumns = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_items'
        AND column_name IN ('category_id_snapshot', 'category_name_snapshot')
      ORDER BY column_name
    `);
    expect(categoryColumns.rows.map((row) => row.column_name)).toEqual([
      'category_id_snapshot',
      'category_name_snapshot',
    ]);

    for (const migrationPath of overlayPaths) {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      const result = await runStatements(pool, 'existing_tenant_v1', sql, {
        migrationKey: path.basename(migrationPath),
        migrationChecksum: checksum(sql),
      });
      expect(result.status).toBe('skipped');
    }

    const probeAfterRerun = await pool.query('SELECT value FROM v1_upgrade_probe WHERE id = 1');
    expect(probeAfterRerun.rows).toEqual([{ value: 'legacy-durable-fact' }]);
  });
});
