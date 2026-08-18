const fs = require('fs');
const path = require('path');

const mockListStockAuditLogs = jest.fn();
const mockGetCustomerDuplicateSuggestions = jest.fn();
const mockGetProductDuplicateSuggestions = jest.fn();

jest.mock('../services/dataQualityService', () => ({
  listStockAuditLogs: mockListStockAuditLogs,
  getCustomerDuplicateSuggestions: mockGetCustomerDuplicateSuggestions,
  getProductDuplicateSuggestions: mockGetProductDuplicateSuggestions,
  mergeCustomers: jest.fn(),
  mergeProducts: jest.fn(),
  exportFullBackup: jest.fn(),
  verifyBackupPayload: jest.fn(),
}));

jest.mock('../services/stockConsistencyService', () => ({
  runConsistencyCheckForRequest: jest.fn(),
  getLatestConsistencyRun: jest.fn(),
}));

const {
  getStockAuditTrail,
  getDuplicateSuggestions,
} = require('./dataQualityController');

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe('V1 Reporting/Admin data-quality support safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListStockAuditLogs.mockResolvedValue([]);
    mockGetCustomerDuplicateSuggestions.mockResolvedValue([]);
    mockGetProductDuplicateSuggestions.mockResolvedValue([]);
  });

  test('support/data-quality routes remain Central-admin protected', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/dataQualityRoutes.js'), 'utf8');
    for (const route of [
      "router.get('/stock-audit', isAdmin, getStockAuditTrail);",
      "router.get('/stock-consistency/latest', isAdmin, getLatestStockConsistency);",
      "router.get('/duplicates', isAdmin, getDuplicateSuggestions);",
      "router.get('/backup/export', isAdmin, exportBackup);",
      "router.post('/backup/verify', isAdmin, verifyBackup);",
    ]) {
      expect(routes).toContain(route);
    }
  });

  test('stock audit uses the request tenant pool and clamps oversized result requests to 500', async () => {
    const tenantPool = { query: jest.fn() };
    const req = { tenantPool, query: { limit: '999999', product_id: '42' } };
    const res = makeResponse();

    await getStockAuditTrail(req, res);

    expect(mockListStockAuditLogs).toHaveBeenCalledWith(tenantPool, {
      limit: 500,
      product_id: '42',
    });
    expect(res.statusCode).toBe(200);
  });

  test('stock audit never forwards zero, negative, or malformed SQL limits', async () => {
    const tenantPool = {};
    for (const rawLimit of ['0', '-50', 'not-a-number']) {
      const res = makeResponse();
      await getStockAuditTrail({ tenantPool, query: { limit: rawLimit } }, res);
      const forwarded = mockListStockAuditLogs.mock.calls.at(-1)[1].limit;
      expect(forwarded).toBeGreaterThanOrEqual(1);
      expect(forwarded).toBeLessThanOrEqual(500);
    }
  });

  test('customer duplicate suggestions are tenant-pooled and capped at 100 rows per query', async () => {
    const tenantPool = {};
    const res = makeResponse();

    await getDuplicateSuggestions({ tenantPool, query: { entity: 'customer', limit: '50000' } }, res);

    expect(mockGetCustomerDuplicateSuggestions).toHaveBeenCalledWith(tenantPool, 100);
    expect(mockGetProductDuplicateSuggestions).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test('product duplicate suggestions use the same bounded Central tenant scope', async () => {
    const tenantPool = {};
    const res = makeResponse();

    await getDuplicateSuggestions({ tenantPool, query: { entity: 'product', limit: '-10' } }, res);

    expect(mockGetProductDuplicateSuggestions).toHaveBeenCalledWith(tenantPool, 1);
    expect(mockGetCustomerDuplicateSuggestions).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
