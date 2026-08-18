const fs = require('fs');
const path = require('path');

const mockListStockAuditLogs = jest.fn();
const mockGetCustomerDuplicateSuggestions = jest.fn();
const mockGetProductDuplicateSuggestions = jest.fn();
const mockMergeCustomers = jest.fn();
const mockMergeProducts = jest.fn();
const mockExportFullBackup = jest.fn();
const mockVerifyBackupPayload = jest.fn();
const mockRunConsistencyCheckForRequest = jest.fn();
const mockGetLatestConsistencyRun = jest.fn();

jest.mock('../services/dataQualityService', () => ({
  listStockAuditLogs: mockListStockAuditLogs,
  getCustomerDuplicateSuggestions: mockGetCustomerDuplicateSuggestions,
  getProductDuplicateSuggestions: mockGetProductDuplicateSuggestions,
  mergeCustomers: mockMergeCustomers,
  mergeProducts: mockMergeProducts,
  exportFullBackup: mockExportFullBackup,
  verifyBackupPayload: mockVerifyBackupPayload,
}));

jest.mock('../services/stockConsistencyService', () => ({
  runConsistencyCheckForRequest: mockRunConsistencyCheckForRequest,
  getLatestConsistencyRun: mockGetLatestConsistencyRun,
}));

const {
  getStockAuditTrail,
  runStockConsistency,
  getLatestStockConsistency,
  getDuplicateSuggestions,
  mergeDuplicate,
  exportBackup,
  verifyBackup,
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
    mockMergeCustomers.mockResolvedValue({ merged: true });
    mockMergeProducts.mockResolvedValue({ merged: true });
    mockExportFullBackup.mockResolvedValue({ version: 1, checksum: 'abc123' });
    mockVerifyBackupPayload.mockReturnValue({ valid: true });
    mockRunConsistencyCheckForRequest.mockResolvedValue({ run_id: 'run-1' });
    mockGetLatestConsistencyRun.mockResolvedValue({ run_id: 'run-1' });
  });

  test('all support/data-quality routes remain Central-admin protected', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/dataQualityRoutes.js'), 'utf8');
    for (const route of [
      "router.get('/stock-audit', isAdmin, getStockAuditTrail);",
      "router.post('/stock-consistency/run', isAdmin, runStockConsistency);",
      "router.get('/stock-consistency/latest', isAdmin, getLatestStockConsistency);",
      "router.get('/duplicates', isAdmin, getDuplicateSuggestions);",
      "router.post('/merge', isAdmin, mergeDuplicate);",
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

  test('manual stock consistency keeps tenant/user request authority and remains explicit manual support work', async () => {
    const tenantPool = {};
    const req = { tenantPool, user: { id: 77 }, body: { auto_heal: false } };
    const res = makeResponse();

    await runStockConsistency(req, res);

    expect(mockRunConsistencyCheckForRequest).toHaveBeenCalledWith(req, {
      autoHeal: false,
      source: 'manual',
      runBy: '77',
    });
    expect(res.statusCode).toBe(200);
  });

  test('latest stock consistency reads through the authenticated tenant request context', async () => {
    const req = { tenantPool: {}, user: { id: 88 } };
    const res = makeResponse();

    await getLatestStockConsistency(req, res);

    expect(mockGetLatestConsistencyRun).toHaveBeenCalledWith(req);
    expect(res.statusCode).toBe(200);
  });

  test('duplicate merge uses the request tenant pool and records the authenticated actor', async () => {
    const tenantPool = {};
    const req = {
      tenantPool,
      user: { id: 19, role: 'admin' },
      body: { entity: 'customer', primary_id: 1, duplicate_id: 2 },
    };
    const res = makeResponse();

    await mergeDuplicate(req, res);

    expect(mockMergeCustomers).toHaveBeenCalledWith(
      tenantPool,
      req.body,
      { user_id: 19, role: 'admin' },
    );
    expect(mockMergeProducts).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test('backup export is an admin support backup using only the request tenant pool, not a reporting download', async () => {
    const tenantPool = {};
    const res = makeResponse();

    await exportBackup({ tenantPool }, res);

    expect(mockExportFullBackup).toHaveBeenCalledWith(tenantPool);
    expect(res.statusCode).toBe(200);
    expect(res.body?.data?.backup || res.body?.backup).toBeDefined();
  });

  test('backup verification validates supplied backup data without selecting another tenant database', async () => {
    const backup = { version: 1, checksum: 'abc123' };
    const res = makeResponse();

    await verifyBackup({ tenantPool: {}, body: { backup } }, res);

    expect(mockVerifyBackupPayload).toHaveBeenCalledWith(backup);
    expect(res.statusCode).toBe(200);
  });
});
