jest.mock('../db', () => ({ query: jest.fn() }));

const { getBranchInventoryReport } = require('./branchInventoryReportController');

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe('V1 branch inventory reporting', () => {
  test('reports physical stock separately from provisional offline oversell deficit', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        physical_stock: '12.500',
        provisional_deficit: '1.250',
        projected_net_stock: '11.250',
        low_stock_products: 2,
        out_of_stock_products: 1,
        stock_value_selling: '1500.00',
        stock_value_purchase: '900.00',
      }],
    });
    const req = {
      tenantPool: { query },
      reportBranchId: '11111111-1111-1111-1111-111111111111',
    };
    const res = makeResponse();

    await getBranchInventoryReport(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      branch_id: req.reportBranchId,
      stock_basis: 'branch_physical_with_provisional_deficit',
      total_stock: 11.25,
      physical_stock: 12.5,
      provisional_deficit: 1.25,
      low_stock_products: 2,
      out_of_stock_products: 1,
      stock_value_selling: 1500,
      stock_value_purchase: 900,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([req.reportBranchId]);
    expect(sql).toContain('b.branch_id = $1::uuid');
    expect(sql).toContain("a.allocation_kind = 'unallocated'");
    expect(sql).toContain("a.source_movement_type = 'sale_issue'");
    expect(sql).toContain("a.source_movement_type = 'sale_return'");
    expect(sql).toContain('p.branch_id = $1::uuid');
    expect(sql).toContain('physical_quantity - provisional_deficit');
    expect(sql).toContain('GREATEST(physical_quantity, 0)');
  });

  test('fails closed without trusted Central branch scope', async () => {
    const query = jest.fn();
    const req = { tenantPool: { query }, reportBranchId: null };
    const res = makeResponse();

    await getBranchInventoryReport(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('REPORT_BRANCH_SCOPE_REQUIRED');
    expect(query).not.toHaveBeenCalled();
  });
});
