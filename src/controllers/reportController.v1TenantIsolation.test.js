const mockDefaultQuery = jest.fn();

jest.mock('../db', () => ({ query: mockDefaultQuery }));

const { getSalesReport } = require('./reportController');

const makeReportQuery = (revenue) => jest.fn()
  .mockResolvedValueOnce({ rows: [{ total_revenue: revenue }] })
  .mockResolvedValueOnce({ rows: [{ total_orders: 1 }] })
  .mockResolvedValueOnce({ rows: [{ total_cost: 60 }] })
  .mockResolvedValueOnce({ rows: [{ total_profit: 40 }] })
  .mockResolvedValueOnce({ rows: [] })
  .mockResolvedValueOnce({ rows: [] });

const makeResponse = () => ({
  body: null,
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe('V1 Reporting/Admin tenant isolation', () => {
  beforeEach(() => {
    mockDefaultQuery.mockClear();
  });

  test('identical report requests remain bound to their supplied tenant PostgreSQL pools', async () => {
    const tenantAQuery = makeReportQuery(111);
    const tenantBQuery = makeReportQuery(222);
    const commonQuery = {
      from_date: '2026-08-01T00:00:00.000Z',
      to_date: '2026-08-31T23:59:59.999Z',
    };

    const tenantAReq = {
      tenantPool: { query: tenantAQuery },
      reportBranchId: null,
      query: commonQuery,
      user: { type: 'tenant', role: 'admin', all_branch_access: true },
    };
    const tenantBReq = {
      tenantPool: { query: tenantBQuery },
      reportBranchId: null,
      query: commonQuery,
      user: { type: 'tenant', role: 'admin', all_branch_access: true },
    };
    const tenantARes = makeResponse();
    const tenantBRes = makeResponse();

    await getSalesReport(tenantAReq, tenantARes);
    await getSalesReport(tenantBReq, tenantBRes);

    expect(tenantAQuery).toHaveBeenCalledTimes(6);
    expect(tenantBQuery).toHaveBeenCalledTimes(6);
    expect(mockDefaultQuery).not.toHaveBeenCalled();
    expect(tenantARes.body.total_revenue).toBe(111);
    expect(tenantBRes.body.total_revenue).toBe(222);
  });
});
