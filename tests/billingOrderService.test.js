jest.mock('../src/services/hsnGst.service', () => ({
  resolveGstPercentage: jest.fn(async () => 0),
}));

const billingOrderService = require('../src/services/billingOrderService');

const createReq = (productRow) => {
  const client = {
    query: jest.fn(async (sql) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'ROLLBACK' || text === 'COMMIT') {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM products')) {
        return { rows: [productRow], rowCount: 1 };
      }
      if (text.includes('INSERT INTO billing_orders')) {
        return {
          rows: [{
            id: 10,
            bill_number: 'BILL-10',
            customer_id: null,
            total_amount: 45,
            gst_amount: 0,
            is_gst_enabled: false,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
          }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO billing_order_items')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    }),
    release: jest.fn(),
  };

  return {
    req: { tenantPool: { connect: jest.fn(async () => client) } },
    client,
  };
};

describe('billingOrderService quantity validation', () => {
  it('rejects decimal quantity for piece-based products', async () => {
    const { req, client } = createReq({
      id: 1,
      hsn_code: null,
      gst_percentage: 0,
      is_weight_based: 0,
    });

    await expect(
      billingOrderService.createOrder(req, {
        is_gst_enabled: false,
        items: [{ product_id: 1, quantity: 4.5, price: 10 }],
      })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Non-integer quantity not allowed for piece based items',
    });

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('allows decimal quantity for weight-based products', async () => {
    const { req } = createReq({
      id: 1,
      hsn_code: null,
      gst_percentage: 0,
      is_weight_based: 1,
    });

    const result = await billingOrderService.createOrder(req, {
      is_gst_enabled: false,
      items: [{ product_id: 1, quantity: 4.5, price: 10 }],
    });

    expect(result.items[0]).toMatchObject({
      product_id: 1,
      quantity: 4.5,
      price: 10,
    });
  });
});
