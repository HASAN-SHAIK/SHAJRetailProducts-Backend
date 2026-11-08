jest.mock('../src/db', () => ({
  query: jest.fn(),
  on: jest.fn(),
}));

const {
  lookupProductForAudit,
  submitStockAuditScans,
} = require('../src/controllers/stockController');

describe('V1 Quick Physical Stocktaking Barcode Audit (FEAT-INV-005)', () => {
  let mockClient;
  let mockPool;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
    };
  });

  test('lookupProductForAudit returns matching product by barcode or id', async () => {
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 55,
          name: 'Basmati Rice 5kg',
          barcode: '8901234567890',
          bookStock: 45,
          price: 650,
          mrp: 750,
          category_id: 3,
          is_weight_based: false,
        },
      ],
    });

    const req = {
      tenantPool: mockPool,
      query: { barcode: '8901234567890' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await lookupProductForAudit(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.product.name).toBe('Basmati Rice 5kg');
    expect(body.product.bookStock).toBe(45);
  });

  test('submitStockAuditScans rejects empty scan payload', async () => {
    const req = {
      tenantPool: mockPool,
      body: { scans: [] },
      user: { id: 1, username: 'cashier1' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await submitStockAuditScans(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('At least one barcode audit scan is required'),
      })
    );
  });

  test('submitStockAuditScans commits physical counts, adjusts stock, and logs variance audit trail', async () => {
    mockClient.query.mockImplementation(async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 1 };
      }
      // Product 1: Book stock 20, physical 22 (+2 variance)
      if (sql.includes('FROM products') && params && params[0] === 10) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 10,
              name: 'Organic Wheat Flour 1kg',
              barcode: '8901111222233',
              stock_quantity: 20,
              price: 85,
              mrp: 95,
            },
          ],
        };
      }
      // Product 2: Book stock 15, physical 15 (0 variance / matched)
      if (sql.includes('FROM products') && params && params[0] === 20) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 20,
              name: 'Sunflower Oil 1L',
              barcode: '8904444555566',
              stock_quantity: 15,
              price: 140,
              mrp: 160,
            },
          ],
        };
      }
      // UPDATE products or INSERT stock_audit_logs
      return { rowCount: 1, rows: [] };
    });

    const req = {
      tenantPool: mockPool,
      body: {
        notes: 'Rack 3 monthly audit',
        scans: [
          { productId: 10, physicalCount: 22 },
          { productId: 20, physicalCount: 15 },
        ],
      },
      user: { id: 2, username: 'auditor1', role: 'manager' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await submitStockAuditScans(req, res);

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(res.status).toHaveBeenCalledWith(200);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.summary.totalScanned).toBe(2);
    expect(body.summary.matched).toBe(1);
    expect(body.summary.discrepancies).toBe(1);
    expect(body.summary.netVariance).toBe(2);

    // Verify stock update query was called for product 10 with physical count 22
    const updateProductCall = mockClient.query.mock.calls.find(
      (c) => c[0] && c[0].includes('UPDATE products') && c[1] && c[1][1] === 10
    );
    expect(updateProductCall).toBeDefined();
    expect(updateProductCall[1][0]).toBe(22);

    // Verify stock_audit_logs was inserted for variance
    const auditInsertCall = mockClient.query.mock.calls.find(
      (c) => c[0] && c[0].includes('INSERT INTO stock_audit_logs')
    );
    expect(auditInsertCall).toBeDefined();
  });
});
