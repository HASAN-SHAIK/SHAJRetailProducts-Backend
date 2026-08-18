const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

jest.mock('../db/masterPool', () => ({ connect: jest.fn() }));
jest.mock('../db/adminPool', () => ({ query: jest.fn() }));
jest.mock('../db/tenantPool', () => ({
  getTenantPool: jest.fn(),
  closeTenantPool: jest.fn(),
}));

const { getFreshTenantOverlayPaths } = require('./tenantProvisionService');

const connectionString = process.env.TEST_FRESH_TENANT_DATABASE_URL;
const describeIfPostgres = connectionString ? describe : describe.skip;

const applySqlFile = async (pool, filePath) => {
  const sql = fs.readFileSync(filePath, 'utf8');
  await pool.query('SET search_path TO public');
  await pool.query(sql);
};

describeIfPostgres('V1 fresh tenant PostgreSQL schema', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const baseline = path.join(process.cwd(), 'Db', 'tenant_schema.sql');
    await applySqlFile(pool, baseline);
    for (const migrationPath of getFreshTenantOverlayPaths()) {
      await applySqlFile(pool, migrationPath);
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('provisions current certified V1 auth, inventory, customer and reporting structures', async () => {
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `, [[
      'products',
      'orders',
      'order_items',
      'customers',
      'pos_inventory_movements',
      'pos_inventory_batch_allocations',
      'pos_customer_mappings'
    ]]);
    expect(new Set(tables.rows.map((row) => row.table_name))).toEqual(new Set([
      'products',
      'orders',
      'order_items',
      'customers',
      'pos_inventory_movements',
      'pos_inventory_batch_allocations',
      'pos_customer_mappings'
    ]));

    const columns = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'pos_inventory_movements' AND column_name = ANY($1::text[])) OR
          (table_name = 'order_items' AND column_name = ANY($2::text[]))
        )
    `, [
      ['canonical_applied_at', 'canonical_branch_id'],
      ['category_id_snapshot', 'category_name_snapshot']
    ]);
    const columnKeys = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    expect(columnKeys).toEqual(new Set([
      'pos_inventory_movements.canonical_applied_at',
      'pos_inventory_movements.canonical_branch_id',
      'order_items.category_id_snapshot',
      'order_items.category_name_snapshot'
    ]));

    const outstandingFunction = await pool.query(
      "SELECT to_regprocedure('recompute_customer_outstanding(bigint)')::text AS fn"
    );
    expect(outstandingFunction.rows[0].fn).toBeTruthy();
  });

  test('fresh tenant role constraint accepts the certified V1 role catalog', async () => {
    const constraint = await pool.query(`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'users'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%role%'
      LIMIT 1
    `);
    expect(constraint.rows).toHaveLength(1);
    const definition = constraint.rows[0].definition;
    expect(definition).toContain('admin');
    expect(definition).toContain('manager');
    expect(definition).toContain('cashier');
    expect(definition).toContain('staff');
  });
});
