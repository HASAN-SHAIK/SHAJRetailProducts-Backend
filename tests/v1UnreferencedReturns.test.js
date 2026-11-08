jest.mock('../src/db', () => ({
  query: jest.fn(),
  on: jest.fn(),
}));

const {
  createUnreferencedReturn,
  listReturns,
  getReturnItems,
} = require('../src/controllers/returnsController');

describe('V1 Unreferenced / Walk-In Item Returns (FEAT-RET-005)', () => {
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

  test('rejects unreferenced return when items array is empty', async () => {
    const req = {
      tenantPool: mockPool,
      body: { items: [] },
      user: { id: 1, username: 'cashier1' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await createUnreferencedReturn(req, res);

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('At least one return item is required'),
      })
    );
  });

  test('successfully processes unreferenced walk-in return with manager override price and restocks good inventory', async () => {
    mockClient.query.mockImplementation(async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 1 };
      }
      // Product lookup
      if (sql.includes('FROM products WHERE id = $1')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 42,
              name: 'Premium Cotton Shirt',
              price: 1200.0,
              gst_percent: 5,
              is_weight_based: false,
            },
          ],
        };
      }
      // Update products stock
      if (sql.includes('UPDATE products')) {
        return { rowCount: 1 };
      }
      // Insert order_returns
      if (sql.includes('INSERT INTO order_returns')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 101,
              return_uuid: 'ret-walkin-uuid-1',
              refund_total: 950.0,
              refund_mode: 'cash',
              reason: 'Customer lost bill; size mismatch',
              manager_approved_by: 'Manager Alice',
              customer_name: 'Rajesh Sharma',
              created_at: new Date('2026-11-08T10:00:00Z'),
              is_unreferenced: true,
            },
          ],
        };
      }
      // Insert order_return_items or accounting_transactions
      if (sql.includes('INSERT INTO order_return_items') || sql.includes('INSERT INTO accounting_transactions')) {
        return { rowCount: 1 };
      }
      return { rowCount: 1, rows: [] };
    });

    const req = {
      tenantPool: mockPool,
      body: {
        customerName: 'Rajesh Sharma',
        reason: 'Customer lost bill; size mismatch',
        managerApprovedBy: 'Manager Alice',
        refundMode: 'cash',
        items: [
          {
            productId: 42,
            quantity: 1,
            unitPrice: 950.0, // Manager discounted override return price
            condition: 'good',
          },
        ],
      },
      user: { id: 2, username: 'alice' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await createUnreferencedReturn(req, res);

    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(res.status).toHaveBeenCalledWith(201);
    const responseData = res.json.mock.calls[0][0];
    expect(responseData.success).toBe(true);
    expect(responseData.return.isUnreferenced).toBe(true);
    expect(responseData.return.refundTotal).toBe(950);
    expect(responseData.return.managerApprovedBy).toBe('Manager Alice');
    expect(responseData.return.items[0].productName).toBe('Premium Cotton Shirt');
    expect(responseData.return.items[0].unitPrice).toBe(950);
    expect(responseData.return.items[0].condition).toBe('good');
  });

  test('does not restock product inventory when return item condition is damaged', async () => {
    const updateProductSpy = jest.fn();
    mockClient.query.mockImplementation(async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 1 };
      if (sql.includes('FROM products WHERE id = $1')) {
        return {
          rowCount: 1,
          rows: [{ id: 99, name: 'Glass Bowl', price: 200, gst_percent: 0 }],
        };
      }
      if (sql.includes('UPDATE products')) {
        updateProductSpy();
        return { rowCount: 1 };
      }
      if (sql.includes('INSERT INTO order_returns')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 102,
              return_uuid: 'ret-damaged-uuid',
              refund_total: 200,
              refund_mode: 'store_credit',
              reason: 'Chipped edge on walk-in return',
              manager_approved_by: 'Manager Bob',
              customer_name: 'Walk-in',
              created_at: new Date(),
              is_unreferenced: true,
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const req = {
      tenantPool: mockPool,
      body: {
        reason: 'Chipped edge on walk-in return',
        refundMode: 'store_credit',
        items: [
          {
            productId: 99,
            quantity: 1,
            unitPrice: 200,
            condition: 'damaged',
          },
        ],
      },
      user: { id: 3, username: 'bob' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await createUnreferencedReturn(req, res);

    expect(updateProductSpy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('listReturns and getReturnItems include unreferenced attributes and product names', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          returnId: 'ret-walkin-uuid-1',
          originalBillId: null,
          refundAmount: 950,
          taxReversed: 45.24,
          date: '2026-11-08T10:00:00Z',
          reason: 'Customer lost bill',
          refundMode: 'cash',
          returnDbId: 101,
          isUnreferenced: true,
          customerName: 'Rajesh Sharma',
          managerApprovedBy: 'Manager Alice',
        },
      ],
    });

    const listReq = { tenantPool: mockPool };
    const listRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listReturns(listReq, listRes);

    expect(listRes.status).toHaveBeenCalledWith(200);
    expect(listRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        returns: expect.arrayContaining([
          expect.objectContaining({
            isUnreferenced: true,
            customerName: 'Rajesh Sharma',
          }),
        ]),
      })
    );

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          returnId: 'ret-walkin-uuid-1',
          originalBillId: null,
          refundAmount: 950,
          taxReversed: 45.24,
          date: '2026-11-08T10:00:00Z',
          reason: 'Customer lost bill',
          isUnreferenced: true,
          customerName: 'Rajesh Sharma',
          managerApprovedBy: 'Manager Alice',
          refundMode: 'cash',
          productId: 42,
          productName: 'Premium Cotton Shirt',
          batchId: null,
          quantity: 1,
          unitPrice: 950,
          lineTotal: 950,
          gstAmount: 45.24,
          itemCondition: 'good',
          managerOverridePrice: 950,
        },
      ],
    });

    const detailReq = { tenantPool: mockPool, params: { id: 'ret-walkin-uuid-1' } };
    const detailRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getReturnItems(detailReq, detailRes);

    expect(detailRes.status).toHaveBeenCalledWith(200);
    const detail = detailRes.json.mock.calls[0][0];
    expect(detail.return.isUnreferenced).toBe(true);
    expect(detail.return.items[0].productName).toBe('Premium Cotton Shirt');
    expect(detail.return.items[0].itemCondition).toBe('good');
  });
});
