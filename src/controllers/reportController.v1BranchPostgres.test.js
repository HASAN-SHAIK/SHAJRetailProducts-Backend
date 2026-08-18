const { Pool } = require('pg');

jest.mock('../db', () => ({ query: jest.fn() }));

const { getHistoricalSalesReport } = require('./historicalSalesReportController');
const { getBranchInventoryReport } = require('./branchInventoryReportController');

const connectionString = process.env.V1_REPORTING_TEST_DATABASE_URL;
const describeIfPostgres = connectionString ? describe : describe.skip;

describeIfPostgres('V1 Reporting/Admin trusted branch PostgreSQL acceptance', () => {
  let pool;
  const branchA = '11111111-1111-4111-8111-111111111111';
  const branchB = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    await pool.query(`
      DROP TABLE IF EXISTS pos_inventory_batch_allocations, batches, order_return_items, order_returns, order_items, orders, products CASCADE;

      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT,
        selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        stock_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
        is_batch_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        branch_id UUID,
        expiry_date DATE,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE
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
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity NUMERIC(14,3) NOT NULL,
        selling_price NUMERIC(14,2),
        purchase_price_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
        profit NUMERIC(14,2) NOT NULL DEFAULT 0,
        source_product_id TEXT,
        sku_snapshot TEXT,
        product_name_snapshot TEXT,
        barcode_snapshot TEXT,
        unit_price_minor BIGINT
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

      CREATE TABLE batches (
        id UUID PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        branch_id UUID,
        quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
        quantity_remaining NUMERIC(14,3),
        expiry_date DATE,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE pos_inventory_batch_allocations (
        movement_id TEXT NOT NULL,
        allocation_seq INTEGER NOT NULL,
        order_id TEXT NOT NULL,
        order_item_id TEXT NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id),
        branch_id UUID NOT NULL,
        batch_id UUID,
        quantity_milli BIGINT NOT NULL,
        allocation_kind TEXT NOT NULL,
        source_movement_type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (movement_id, allocation_seq)
      );
    `);

    await pool.query(
      `INSERT INTO products (
         id, name, company, selling_price, purchase_price, stock_quantity,
         is_batch_enabled, branch_id, expiry_date
       ) VALUES
         (1, 'Current Renamed Milk', 'A Co', 50, 30, 5, FALSE, $1, NULL),
         (2, 'Current Renamed Rice', 'B Co', 100, 60, 9, FALSE, $2, NULL),
         (3, 'Branch A Batch Med', 'A Pharma', 20, 10, 3.25, TRUE, NULL, NULL)`,
      [branchA, branchB]
    );
    await pool.query(
      `INSERT INTO orders (id, branch_id, total_price, returned_amount, order_status, created_at)
       VALUES
         (1, $1, 100, 20, 'partially_returned', '2026-08-10T10:00:00Z'),
         (2, $2, 300, 0, 'completed', '2026-08-10T11:00:00Z'),
         (3, $1, 60, 60, 'fully_returned', '2026-08-10T12:00:00Z')`,
      [branchA, branchB]
    );
    await pool.query(
      `INSERT INTO order_items (
         order_id, product_id, quantity, selling_price, purchase_price_snapshot, profit,
         source_product_id, sku_snapshot, product_name_snapshot, barcode_snapshot, unit_price_minor
       ) VALUES
         (1, 1, 2, 42, 30, 40, 'pos-product-a', 'MILK-A', 'Branch A Milk', '111', 4200),
         (2, 2, 3, 90, 60, 120, 'pos-product-b', 'RICE-B', 'Branch B Rice', '222', 9000),
         (3, 1, 1, 42, 40, 20, 'pos-product-a', 'MILK-A', 'Branch A Milk', '111', 4200)`
    );
    await pool.query(`INSERT INTO order_returns (id, order_id) VALUES (1, 1), (2, 3)`);
    await pool.query(
      `INSERT INTO order_return_items (return_id, product_id, quantity)
       VALUES (1, 1, 1), (2, 1, 1)`
    );

    await pool.query(
      `INSERT INTO batches (id, product_id, branch_id, quantity, quantity_remaining, expiry_date)
       VALUES
         ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 3, $1, 4, 4, '2027-01-01'),
         ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 3, $1, 2, 2, '2026-01-01'),
         ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 3, $2, 7, 7, '2027-01-01')`,
      [branchA, branchB]
    );
    await pool.query(
      `INSERT INTO pos_inventory_batch_allocations (
         movement_id, allocation_seq, order_id, order_item_id, product_id, branch_id,
         batch_id, quantity_milli, allocation_kind, source_movement_type
       ) VALUES
         ('issue-a', 1, 'order-a', 'item-a', 3, $1, NULL, 1000, 'unallocated', 'sale_issue'),
         ('return-a', 1, 'order-a', 'item-a', 3, $1, NULL, 250, 'unallocated', 'sale_return'),
         ('issue-b', 1, 'order-b', 'item-b', 3, $2, NULL, 2000, 'unallocated', 'sale_issue')`,
      [branchA, branchB]
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const makeResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });

  const runSalesReport = async (reportBranchId) => {
    const req = {
      tenantPool: pool,
      reportBranchId,
      query: { from_date: '2026-08-01T00:00:00Z', to_date: '2026-08-31T23:59:59Z' },
      user: { type: 'tenant', role: 'manager' },
    };
    const res = makeResponse();

    await getHistoricalSalesReport(req, res);
    expect(res.statusCode).toBe(200);
    return res.body;
  };

  const runInventoryReport = async (reportBranchId) => {
    const req = {
      tenantPool: pool,
      reportBranchId,
      user: { type: 'tenant', role: 'manager' },
    };
    const res = makeResponse();

    await getBranchInventoryReport(req, res);
    expect(res.statusCode).toBe(200);
    return res.body;
  };

  test('branch A report excludes branch B and keeps immutable product snapshots after catalog rename', async () => {
    const report = await runSalesReport(branchA);

    expect(Number(report.total_revenue)).toBe(80);
    expect(Number(report.total_orders)).toBe(2);
    expect(Number(report.totalProfit)).toBe(20);
    expect(report.bestSellingProducts).toHaveLength(1);
    expect(report.bestSellingProducts[0].name || report.bestSellingProducts[0].Name).toBe('Branch A Milk');
    expect(Number(report.bestSellingProducts[0].noofsold || report.bestSellingProducts[0].NoOfSold)).toBe(1);
    expect(report.profitByProduct).toHaveLength(1);
    expect(report.profitByProduct[0].name || report.profitByProduct[0].Name).toBe('Branch A Milk');
    expect(Number(report.profitByProduct[0].price || report.profitByProduct[0].Price)).toBe(42);
  });

  test('branch inventory separates physical, sellable, expired, and provisional deficit truth', async () => {
    const report = await runInventoryReport(branchA);

    expect(report.branch_id).toBe(branchA);
    expect(report.stock_basis).toBe('branch_sellable_with_expiry_and_provisional_deficit');
    expect(report.physical_stock).toBe(11);
    expect(report.sellable_stock).toBe(9);
    expect(report.expired_stock).toBe(2);
    expect(report.provisional_deficit).toBe(0.75);
    expect(report.total_stock).toBe(8.25);
    expect(report.stock_value_selling).toBe(330);
    expect(report.stock_value_purchase).toBe(190);
  });

  test('branch inventory excludes another branch batches and provisional deficit', async () => {
    const report = await runInventoryReport(branchB);

    expect(report.physical_stock).toBe(16);
    expect(report.sellable_stock).toBe(16);
    expect(report.expired_stock).toBe(0);
    expect(report.provisional_deficit).toBe(2);
    expect(report.total_stock).toBe(14);
  });

  test('replaying the canonical full-return facts does not change branch reporting', async () => {
    const beforeReplay = await runSalesReport(branchA);

    await pool.query(
      `UPDATE orders
       SET returned_amount = total_price,
           order_status = 'fully_returned'
       WHERE id = 3`
    );
    await pool.query(
      `UPDATE orders
       SET returned_amount = total_price,
           order_status = 'fully_returned'
       WHERE id = 3`
    );

    const afterReplay = await runSalesReport(branchA);
    expect(afterReplay).toEqual(beforeReplay);
    expect(Number(afterReplay.total_revenue)).toBe(80);
    expect(Number(afterReplay.totalProfit)).toBe(20);
  });

  test('tenant-wide sales report remains available only when no branch scope is supplied', async () => {
    const report = await runSalesReport(null);

    expect(Number(report.total_revenue)).toBe(380);
    expect(Number(report.total_orders)).toBe(3);
    expect(report.bestSellingProducts).toHaveLength(2);
  });
});
