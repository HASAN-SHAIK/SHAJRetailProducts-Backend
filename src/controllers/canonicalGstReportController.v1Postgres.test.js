jest.mock('../db', () => ({}));

const { Pool } = require('pg');
const { getCanonicalGstReports } = require('./canonicalGstReportController');

const DATABASE_URL = process.env.V1_GST_REPORT_DATABASE_URL;
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const makeResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
};

maybeDescribe('V1 canonical GST reporting PostgreSQL acceptance', () => {
  let tenantPool;
  const branchA = '11111111-1111-1111-1111-111111111111';
  const branchB = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    tenantPool = new Pool({ connectionString: DATABASE_URL, ssl: false });
    await tenantPool.query(`
      DROP TABLE IF EXISTS pos_partial_return_items;
      DROP TABLE IF EXISTS pos_partial_returns;
      DROP TABLE IF EXISTS order_items;
      DROP TABLE IF EXISTS orders;

      CREATE TABLE orders (
        id BIGINT PRIMARY KEY,
        branch_id UUID,
        source_channel TEXT,
        completed_at TIMESTAMPTZ,
        source_returned_at TIMESTAMPTZ
      );
      CREATE TABLE order_items (
        order_id BIGINT NOT NULL,
        source_item_id TEXT NOT NULL,
        quantity_milli BIGINT NOT NULL,
        taxable_minor BIGINT NOT NULL,
        tax_minor BIGINT NOT NULL,
        PRIMARY KEY(order_id, source_item_id)
      );
      CREATE TABLE pos_partial_returns (
        return_id TEXT PRIMARY KEY,
        order_id BIGINT NOT NULL,
        source_version INT NOT NULL,
        source_returned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE pos_partial_return_items (
        return_id TEXT NOT NULL,
        source_item_id TEXT NOT NULL,
        quantity_milli BIGINT NOT NULL,
        PRIMARY KEY(return_id, source_item_id)
      );

      INSERT INTO orders(id, branch_id, source_channel, completed_at, source_returned_at) VALUES
        (1, '${branchA}', 'pos', '2026-08-01T10:00:00Z', '2026-08-04T10:00:00Z'),
        (2, '${branchB}', 'pos', '2026-08-01T11:00:00Z', NULL);
      INSERT INTO order_items(order_id, source_item_id, quantity_milli, taxable_minor, tax_minor) VALUES
        (1, 'item-a', 1000, 10000, 1800),
        (2, 'item-b', 1000, 5000, 900);
      INSERT INTO pos_partial_returns(return_id, order_id, source_version, source_returned_at) VALUES
        ('ret-a-1', 1, 2, '2026-08-02T10:00:00Z'),
        ('ret-a-2', 1, 3, '2026-08-03T10:00:00Z');
      INSERT INTO pos_partial_return_items(return_id, source_item_id, quantity_milli) VALUES
        ('ret-a-1', 'item-a', 333),
        ('ret-a-2', 'item-a', 333);
    `);
  });

  afterAll(async () => {
    if (tenantPool) await tenantPool.end();
  });

  test('allocates immutable partial-return GST cumulatively and leaves the full-return residual on its event date', async () => {
    const res = makeResponse();
    await getCanonicalGstReports(
      {
        tenantPool,
        reportBranchId: branchA,
        query: { from: '2026-08-01', to: '2026-08-04' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.authority).toBe('canonical_pos_tax_snapshots');
    expect(res.body.component_breakdown_available).toBe(false);
    expect(res.body.reports).toEqual([
      { date: '2026-08-04', taxable_amount: -33.4, total_gst: -6.01 },
      { date: '2026-08-03', taxable_amount: -33.3, total_gst: -6 },
      { date: '2026-08-02', taxable_amount: -33.3, total_gst: -5.99 },
      { date: '2026-08-01', taxable_amount: 100, total_gst: 18 },
    ]);
    const netTax = res.body.reports.reduce((sum, row) => sum + row.total_gst, 0);
    expect(Math.abs(netTax)).toBeLessThan(0.000001);
  });

  test('keeps another branch out of a branch-scoped GST report', async () => {
    const res = makeResponse();
    await getCanonicalGstReports(
      {
        tenantPool,
        reportBranchId: branchA,
        query: { from: '2026-08-01', to: '2026-08-01' },
      },
      res
    );
    expect(res.body.reports).toEqual([{ date: '2026-08-01', taxable_amount: 100, total_gst: 18 }]);

    const allBranch = makeResponse();
    await getCanonicalGstReports(
      {
        tenantPool,
        reportBranchId: null,
        query: { from: '2026-08-01', to: '2026-08-01' },
      },
      allBranch
    );
    expect(allBranch.body.reports).toEqual([{ date: '2026-08-01', taxable_amount: 150, total_gst: 27 }]);
  });
});
