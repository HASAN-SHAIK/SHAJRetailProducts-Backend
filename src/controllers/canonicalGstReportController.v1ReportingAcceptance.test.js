jest.mock('../db', () => ({ query: jest.fn() }));

const {
  CANONICAL_GST_REPORT_SQL,
  MAX_GST_REPORT_RANGE_DAYS,
  getCanonicalGstReports,
} = require('./canonicalGstReportController');

const makeResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status: jest.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body) => {
      res.body = body;
      return res;
    }),
  };
  return res;
};

describe('V1 canonical GST reporting', () => {
  test('uses immutable POS sale/return snapshots and never the legacy gst ledger', () => {
    expect(CANONICAL_GST_REPORT_SQL).toContain("o.source_channel = 'pos'");
    expect(CANONICAL_GST_REPORT_SQL).toContain('oi.taxable_minor');
    expect(CANONICAL_GST_REPORT_SQL).toContain('oi.tax_minor');
    expect(CANONICAL_GST_REPORT_SQL).toContain('pos_partial_returns');
    expect(CANONICAL_GST_REPORT_SQL).toContain('pos_partial_return_items');
    expect(CANONICAL_GST_REPORT_SQL).toContain('source_returned_at');
    expect(CANONICAL_GST_REPORT_SQL).toContain('prior_returned_quantity_milli');
    expect(CANONICAL_GST_REPORT_SQL).not.toContain('gst_ledger');
    expect(CANONICAL_GST_REPORT_SQL).not.toContain('gst_percentage');
  });

  test('binds the trusted report branch and returns total GST without fabricating jurisdiction components', async () => {
    const tenantPool = {
      query: jest.fn().mockResolvedValue({
        rows: [{ date: '2026-08-18', taxable_amount: '100.00', total_gst: '18.00' }],
      }),
    };
    const req = {
      tenantPool,
      reportBranchId: '11111111-1111-1111-1111-111111111111',
      query: { from: '2026-08-18', to: '2026-08-18' },
    };
    const res = makeResponse();

    await getCanonicalGstReports(req, res);

    expect(tenantPool.query).toHaveBeenCalledTimes(1);
    const [, params] = tenantPool.query.mock.calls[0];
    expect(params[0]).toBe(req.reportBranchId);
    expect(params[1]).toEqual(new Date('2026-08-18T00:00:00.000Z'));
    expect(params[2]).toEqual(new Date('2026-08-19T00:00:00.000Z'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      authority: 'canonical_pos_tax_snapshots',
      component_breakdown_available: false,
      reports: [{ date: '2026-08-18', taxable_amount: 100, total_gst: 18 }],
    });
    expect(res.body.reports[0]).not.toHaveProperty('cgst');
    expect(res.body.reports[0]).not.toHaveProperty('sgst');
    expect(res.body.reports[0]).not.toHaveProperty('igst');
  });

  test('rejects incomplete, invalid, reversed and oversized explicit ranges before PostgreSQL', async () => {
    const cases = [
      { query: { from: '2026-08-18' }, code: 'GST_REPORT_DATE_RANGE_REQUIRED' },
      { query: { from: '2026-02-30', to: '2026-03-01' }, code: 'GST_REPORT_DATE_RANGE_INVALID' },
      { query: { from: '2026-08-19', to: '2026-08-18' }, code: 'GST_REPORT_DATE_RANGE_INVALID' },
      { query: { from: '2025-08-18', to: '2026-08-19' }, code: 'GST_REPORT_DATE_RANGE_TOO_LARGE' },
    ];

    for (const item of cases) {
      const tenantPool = { query: jest.fn() };
      const res = makeResponse();
      await getCanonicalGstReports({ tenantPool, reportBranchId: null, query: item.query }, res);
      expect(tenantPool.query).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe(item.code);
    }
    expect(MAX_GST_REPORT_RANGE_DAYS).toBe(366);
  });

  test('keeps an omitted range bounded by at most 366 daily rows', async () => {
    const tenantPool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const res = makeResponse();
    await getCanonicalGstReports({ tenantPool, reportBranchId: null, query: {} }, res);
    expect(tenantPool.query).toHaveBeenCalledWith(CANONICAL_GST_REPORT_SQL, [null, null, null]);
    expect(CANONICAL_GST_REPORT_SQL).toContain('LIMIT 366');
    expect(res.statusCode).toBe(200);
  });
});
