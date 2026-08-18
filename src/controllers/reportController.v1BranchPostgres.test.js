const { Pool } = require('pg');

jest.mock('../db', () => ({ query: jest.fn() }));

const { getSalesReport } = require('./reportController');

const connectionString = process.env.V1_REPORTING_TEST_DATABASE_URL;
const describeIfPostgres = connectionString ? describe : describe.skip;

describeIfPostgres('V1 Reporting/Admin trusted branch PostgreSQL acceptance', () => {
  let pool;
  const branchA = '11111111-1111-4111-8111-111111111111';
  const branchB = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    await pool.query(`
      DROP TABLE IF EXISTS order_return_items, order_returns, order_items, orders, products CASCADE;

      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT,
        selling_price NUMERIC(14,2) NOT NULL DEFAULT 0
      );

      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        branch_id UUID,
        total_price NUMERIC(14,2) NOT NULL,
        returned_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        order_status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE order_items (
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity NUMERIC(14,3) NOT NULL,
        purchase_price_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
        profit NUMERIC(14,2) NOT NULL DEFAULT 0
      );

      CREATE TABLE order_returns (
        id INTEGER PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id)
      );

      CREATE TABLE order_return_items (
        return_id INTEGER NOT NULL REFERENCES order_returns(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity NUMERIC(14,3) NOT NULL
      );
    `);

    await pool.query(
      `INSERT INTO products (id, name, company, selling_price)
       VALUES (1, 'Branch A Milk', 'A Co', 50), (2, 'Branch B Rice', 'B Co', 100)`
    );
    await pool.query(
      `INSERT INTO orders (id, branch_id, total_price, returned_amount, order_status, created_at)
       VALUES
         (1, $1, 100, 20, 'partially_returned', '2026-08-10T10:00:00Z'),
         (2, $2, 300, 0, 'completed', '2026-08-10T11:00:00Z')`,
      [branchA, branchB]
    );
    await pool.query(
      `INSERT INTO order_items (order_id, product_id, quantity, purchase_price_snapshot, profit)
       VALUES (1, 1, 2, 30, 40), (2, 2, 3, 60, 120)`
    );
    await pool.query(`INSERT INTO order_returns (id, order_id) VALUES (1, 1)`);
    await pool.query(`INSERT INTO order_return_items (return_id, product_id, quantity) VALUES (1, 1, 1)`);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const runSalesReport = async (reportBranchId) => {
    const req = {
      tenantPool: pool,
      reportBranchId,
      query: { from_date: '2026-08-01T00:00:00Z', to_date: '2026-08-31T23:59:59Z' },
      user: { type: 'tenant', role: 'manager' },
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    await getSalesReport(req, res);
    expect(res.statusCode).toBe(200);
    return res.body;
  };

  test('branch A report excludes branch B and keeps refund-aware net facts', async () => {
    const report = await runSalesReport(branchA);

    expect(Number(report.total_revenue)).toBe(80);
    expect(Number(report.total_orders)).toBe(1);
    expect(Number(report.totalProfit)).toBe(20);
    expect(report.bestSellingProducts).toHaveLength(1);
    expect(report.bestSellingProducts[0].name || report.bestSellingProducts[0].Name).toBe('Branch A Milk');
    expect(report.profitByProduct).toHaveLength(1);
    expect(report.profitByProduct[0].name || report.profitByProduct[0].Name).toBe('Branch A Milk');
  });

  test('tenant-wide report remains available only when no branch scope is supplied', async () => {
    const report = await runSalesReport(null);

    expect(Number(report.total_revenue)).toBe(380);
    expect(Number(report.total_orders)).toBe(2);
    expect(report.bestSellingProducts).toHaveLength(2);
  });
});
