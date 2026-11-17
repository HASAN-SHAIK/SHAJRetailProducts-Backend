const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createCustomer } = require('./service');
const { main: runReport } = require('../../../scripts/report-duplicate-customer-phones.cjs');

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const INDEX = 'idx_customers_active_phone_digits_unique';
const SCHEMA = 'phone_unique_test';
const root = path.join(__dirname, '..', '..', '..');
const migrationSql = fs.readFileSync(path.join(root, 'Db', 'migrations', '2026-11-17-customer-active-phone-unique.sql'), 'utf8');
const tenantSchemaSql = fs.readFileSync(path.join(root, 'Db', 'tenant_schema.sql'), 'utf8');

describePostgres('customer active-phone unique index', () => {
  let pool;
  let notices;
  const q = (sql, params) => pool.query(sql, params);
  const hasIndex = async () =>
    (await q('SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname=$2', [SCHEMA, INDEX])).rowCount === 1;
  const runMigration = async () => {
    const client = await pool.connect();
    notices = [];
    client.on('notice', (n) => notices.push(n.message));
    try {
      await client.query(migrationSql);
    } finally {
      client.release();
    }
  };
  const report = async (format) => {
    const out = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s));
      return true;
    });
    try {
      const code = await runReport([`--format=${format}`], { TENANT_DATABASE_URL: databaseUrl, TENANT_SEARCH_PATH: SCHEMA });
      return { code, out: out.join('') };
    } finally {
      spy.mockRestore();
    }
  };

  beforeAll(async () => {
    // Own schema: other suites drop/recreate public.customers on the shared test DB.
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query('DROP SCHEMA IF EXISTS ' + SCHEMA + ' CASCADE');
    await admin.query('CREATE SCHEMA ' + SCHEMA);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${SCHEMA}`, max: 4 });
    await q(`CREATE TABLE customers (
      id SERIAL PRIMARY KEY, name VARCHAR(255), mobile VARCHAR(15), phone TEXT,
      type TEXT DEFAULT 'retail', email TEXT, location VARCHAR(100), address TEXT, shop_name TEXT,
      gst_number TEXT, credit_limit NUMERIC DEFAULT 0, current_balance NUMERIC DEFAULT 0, notes TEXT,
      is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query('DROP SCHEMA IF EXISTS ' + SCHEMA + ' CASCADE');
    await admin.end();
  });

  beforeEach(async () => {
    await q('DROP INDEX IF EXISTS ' + INDEX);
    await q('TRUNCATE customers RESTART IDENTITY');
  });

  test('schema baseline carries the same guarded block as the migration', () => {
    const block = migrationSql.slice(migrationSql.indexOf('DO $$'));
    expect(tenantSchemaSql).toContain(block.trim());
  });

  test('creates the index when clean, ignoring inactive, blank and formatting variants', async () => {
    await q(`INSERT INTO customers(name, phone, is_active) VALUES
      ('A','98765 43210',TRUE), ('A old','+91-98765-43210',FALSE), ('blank',NULL,TRUE), ('blank2','',TRUE), ('B','9111111111',TRUE)`);
    await runMigration();
    expect(await hasIndex()).toBe(true);
    await runMigration();
    expect(notices.join(' ')).toMatch(/already exists/);
  });

  test('skips with NOTICE and leaves data untouched when duplicates exist', async () => {
    await q(`INSERT INTO customers(name, phone, current_balance) VALUES ('A','98765-43210',10), ('B','(98765) 43210',20)`);
    await runMigration();
    expect(await hasIndex()).toBe(false);
    expect(notices.join(' ')).toMatch(/duplicate active customer phones exist/);
    expect((await q('SELECT count(*)::int n FROM customers')).rows[0].n).toBe(2);
  });

  test('report script lists duplicate groups and exits non-zero; zero when clean', async () => {
    await q(`INSERT INTO customers(name, phone, current_balance) VALUES ('A','98765-43210',10), ('B','98765 43210',20), ('C','9000000000',0)`);
    const dup = await report('json');
    expect(dup.code).toBe(1);
    const parsed = JSON.parse(dup.out);
    expect(parsed.duplicate_groups).toBe(1);
    expect(parsed.groups[0]).toMatchObject({ digits: '9876543210', customer_ids: [1, 2] });
    await q("UPDATE customers SET is_active=FALSE WHERE name='B'");
    const clean = await report('csv');
    expect(clean.code).toBe(0);
  });

  test('with the index, a second active customer with same digits is rejected and mapped to 409', async () => {
    await q(`INSERT INTO customers(name, phone) VALUES ('A','98765 43210')`);
    await runMigration();
    expect(await hasIndex()).toBe(true);
    await expect(q(`INSERT INTO customers(name, mobile) VALUES ('B','+98765-43210')`)).rejects.toMatchObject({
      code: '23505',
      constraint: INDEX,
    });
    await q(`INSERT INTO customers(name, phone, is_active) VALUES ('C','9876543210',FALSE)`);
    await expect(q('UPDATE customers SET is_active=TRUE WHERE name=$1', ['C'])).rejects.toMatchObject({ code: '23505' });
    await expect(createCustomer(pool, { name: 'D', phone: '98765 43210' })).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_CUSTOMER',
    });
    const ok = await createCustomer(pool, { name: 'E', phone: '9222222222' });
    expect(ok.id).toBeDefined();
  });
});
