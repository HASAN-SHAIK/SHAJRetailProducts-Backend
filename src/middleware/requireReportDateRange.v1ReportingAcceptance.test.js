const fs = require('fs');
const path = require('path');
const {
  MAX_REPORT_RANGE_DAYS,
  requireReportDateRange,
} = require('./requireReportDateRange');

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const run = (query) => {
  const req = { query: { ...query } };
  const res = makeResponse();
  const next = jest.fn();
  requireReportDateRange(req, res, next);
  return { req, res, next };
};

describe('V1 reporting bounded date ranges', () => {
  test('sales and profit routes use the bounded range middleware', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reportRoutes.js'), 'utf8');
    expect(source).toContain("router.get('/sales', requirePermission('reports:read'), requireReportScope, requireReportDateRange, getHistoricalSalesReport)");
    expect(source).toContain("router.get('/profit', requirePermission('reports:read'), requireReportScope, requireReportDateRange, getProfitReport)");
  });

  test('keeps the existing default period when neither date is supplied', () => {
    const { next } = run({});
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('requires both strict valid YYYY-MM-DD bounds', () => {
    expect(run({ from_date: '2026-08-01' }).res.body.code).toBe('REPORT_DATE_RANGE_REQUIRED');
    expect(run({ from_date: '2026-02-30', to_date: '2026-03-01' }).res.body.code).toBe('REPORT_DATE_RANGE_INVALID');
    expect(run({ from_date: '08/01/2026', to_date: '08/02/2026' }).res.body.code).toBe('REPORT_DATE_RANGE_INVALID');
  });

  test('rejects reversed and oversized ranges', () => {
    expect(run({ from_date: '2026-08-02', to_date: '2026-08-01' }).res.body.code).toBe('REPORT_DATE_RANGE_INVALID');
    expect(MAX_REPORT_RANGE_DAYS).toBe(366);
    expect(run({ from_date: '2025-01-01', to_date: '2026-01-02' }).res.body.code).toBe('REPORT_DATE_RANGE_TOO_LARGE');
  });

  test('normalizes accepted dates to deterministic UTC day bounds', () => {
    const { req, next } = run({ from_date: '2026-08-01', to_date: '2026-08-02' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.from_date.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(req.query.to_date.toISOString()).toBe('2026-08-02T23:59:59.999Z');
    expect(req.reportDateRange.rangeDays).toBe(2);
  });
});
