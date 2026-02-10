const pool = require('../src/db');

const {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
  markOrderAsPaid,
  getCategories,
  syncOfflineOrders
} = require('../src/controllers/orderController');

jest.mock('../src/db', () => ({
  query: jest.fn(),
  connect: jest.fn()
}));

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const buildClient = () => {
  return {
    query: jest.fn(),
    release: jest.fn()
  };
};

describe('orderController unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('returns 400 when user_id or transaction_type missing', async () => {
      const req = { body: { user_id: null, transaction_type: null } };
      const res = buildRes();

      await createOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'userId and transaction type should be There' });
    });

    it('creates a sale order successfully', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ selling_price: 100, actual_price: 60, stock_quantity: 10, is_weight_based: 0 }]
        }) // SELECT product
        .mockResolvedValueOnce({}) // UPDATE stock
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // INSERT orders
        .mockResolvedValueOnce({ rows: [{ id: 1, selling_price: 100 }] }) // SELECT product for order_items
        .mockResolvedValueOnce({}) // INSERT order_items
        .mockResolvedValueOnce({}) // INSERT transactions
        .mockResolvedValueOnce({}); // COMMIT

      const req = {
        body: {
          user_id: 1,
          transaction_type: 'sale',
          payment_method: 'cash',
          products: [{ product_id: 1, quantity: 2 }]
        }
      };
      const res = buildRes();

      await createOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Order created successfully',
        order_id: 10,
        payment_method: 'cash'
      });
    });

    it('creates a sale order with decimal quantity for weight-based product', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ selling_price: 100, actual_price: 60, stock_quantity: 10, is_weight_based: 1 }]
        }) // SELECT product
        .mockResolvedValueOnce({}) // UPDATE stock
        .mockResolvedValueOnce({ rows: [{ id: 11 }] }) // INSERT orders
        .mockResolvedValueOnce({ rows: [{ id: 1, selling_price: 100 }] }) // SELECT product for order_items
        .mockResolvedValueOnce({}) // INSERT order_items
        .mockResolvedValueOnce({}) // INSERT transactions
        .mockResolvedValueOnce({}); // COMMIT

      const req = {
        body: {
          user_id: 1,
          transaction_type: 'sale',
          payment_method: 'cash',
          products: [{ product_id: 1, quantity: 2.75 }]
        }
      };
      const res = buildRes();

      await createOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Order created successfully',
        order_id: 11,
        payment_method: 'cash'
      });
    });

    it('returns 400 when non-integer quantity provided for piece-based product', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ selling_price: 100, actual_price: 60, stock_quantity: 10, is_weight_based: 0 }]
        }); // SELECT product

      const req = {
        body: {
          user_id: 1,
          transaction_type: 'sale',
          payment_method: 'cash',
          products: [{ product_id: 1, quantity: 1.5 }]
        }
      };
      const res = buildRes();

      await createOrder(req, res);

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Non-integer quantity not allowed for piece based items' });
    });

    it('returns 400 on insufficient stock for sale', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ selling_price: 100, actual_price: 60, stock_quantity: 1, is_weight_based: 0 }]
        }); // SELECT product

      const req = {
        body: {
          user_id: 1,
          transaction_type: 'sale',
          payment_method: 'cash',
          products: [{ product_id: 1, quantity: 2 }]
        }
      };
      const res = buildRes();

      await createOrder(req, res);

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient stock for Product ID 1. Available: 1' });
    });

    it('creates a purchase order successfully', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 20 }] }) // INSERT orders
        .mockResolvedValueOnce({ rows: [] }) // SELECT product (not exists)
        .mockResolvedValueOnce({}) // INSERT product
        .mockResolvedValueOnce({}) // INSERT transaction
        .mockResolvedValueOnce({}); // COMMIT

      const req = {
        body: {
          user_id: 1,
          transaction_type: 'purchase',
          total_amount: 500,
          payment_mode: 'cash',
          products: [
            {
              product_name: 'Item A',
              company: 'ACME',
              quantity: 2,
              actual_price: 100,
              selling_price: 150,
              category: 'cat',
              time_for_delivery: '2d'
            }
          ]
        }
      };
      const res = buildRes();

      await createOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Purchase order created successfully',
        transaction_type: 'purchase',
        orderId: 20
      });
    });

    it('creates a personal order successfully', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 30 }] }) // INSERT orders
        .mockResolvedValueOnce({}) // INSERT transactions
        .mockResolvedValueOnce({}); // COMMIT

      const req = {
        body: {
          user_id: 1,
          transaction_type: 'personal',
          total_amount: 200,
          payment_method: 'cash'
        }
      };
      const res = buildRes();

      await createOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Personal transaction recorded successfully',
        orderId: 30,
        transaction_type: 'personal'
      });
    });
  });

  describe('getOrderById', () => {
    it('returns 404 when order not found', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const req = { params: { id: 999 } };
      const res = buildRes();

      await getOrderById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Order not found' });
    });

    it('returns order and items when found', async () => {
      pool.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ name: 'Item', quantity: 2, selling_price: 100 }] });
      const req = { params: { id: 1 } };
      const res = buildRes();

      await getOrderById(req, res);

      expect(res.json).toHaveBeenCalledWith({
        order: { id: 1 },
        items: [{ name: 'Item', quantity: 2, selling_price: 100 }]
      });
    });
  });

  describe('getAllOrders', () => {
    it('returns 404 when no orders', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const req = { query: {} };
      const res = buildRes();

      await getAllOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'No orders found' });
    });

    it('returns orders with items and counts', async () => {
      pool.query.mockImplementation((sql) => {
        if (sql.startsWith('select o.*, u.name as username')) {
          return Promise.resolve({ rowCount: 1, rows: [{ id: 1 }] });
        }
        if (sql.startsWith('SELECT p.id as product_id')) {
          return Promise.resolve({ rows: [{ product_id: 1, quantity: 2, selling_price: 100 }] });
        }
        if (sql.includes("order_status = 'completed'")) {
          return Promise.resolve({ rows: [{ total_orders: '3' }] });
        }
        if (sql.includes("order_status = 'pending'")) {
          return Promise.resolve({ rows: [{ total_orders: '2' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const req = { query: {} };
      const res = buildRes();

      await getAllOrders(req, res);

      expect(res.json).toHaveBeenCalledWith({
        orders: [{ id: 1, items: [{ product_id: 1, quantity: 2, selling_price: 100 }] }],
        completedOrders: 3,
        pendingOrders: 2,
        totalOrders: 5
      });
    });
  });

  describe('updateOrder', () => {
    it('updates order successfully', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ product_id: 1, quantity: 1 }] }) // old items
        .mockResolvedValueOnce({}) // restore stock
        .mockResolvedValueOnce({}) // delete old items
        .mockResolvedValueOnce({ rows: [{ stock_quantity: 10, actual_price: 60, selling_price: 100, is_weight_based: 0 }] }) // select product info
        .mockResolvedValueOnce({}) // insert new item
        .mockResolvedValueOnce({}) // update stock
        .mockResolvedValueOnce({}) // update transactions
        .mockResolvedValueOnce({}) // update orders
        .mockResolvedValueOnce({}); // COMMIT

      const req = {
        params: { id: '1' },
        body: {
          payment_method: 'cash',
          products: [{ product_id: 1, quantity: 2, selling_price: 100 }]
        }
      };
      const res = buildRes();

      await updateOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Order updated successfully' });
    });

    it('returns 400 when non-integer quantity provided for piece-based update', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ product_id: 1, quantity: 1 }] }) // old items
        .mockResolvedValueOnce({}) // restore stock
        .mockResolvedValueOnce({}) // delete old items
        .mockResolvedValueOnce({ rows: [{ stock_quantity: 10, actual_price: 60, selling_price: 100, is_weight_based: 0 }] }); // select product info

      const req = {
        params: { id: '1' },
        body: {
          payment_method: 'cash',
          products: [{ product_id: 1, quantity: 1.5, selling_price: 100 }]
        }
      };
      const res = buildRes();

      await updateOrder(req, res);

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Non-integer quantity not allowed for piece based items' });
    });
  });

  describe('deleteOrder', () => {
    it('returns 404 when order not found', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }); // transaction type not found

      const req = { params: { id: '999' } };
      const res = buildRes();

      await deleteOrder(req, res);

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Order not found' });
    });

    it('deletes sale order and restores stock', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ transaction_type: 'sale' }] }) // transaction type
        .mockResolvedValueOnce({ rows: [{ product_id: 1, quantity: 2 }] }) // order items
        .mockResolvedValueOnce({}) // update product stock
        .mockResolvedValueOnce({}) // delete order_items
        .mockResolvedValueOnce({}) // delete orders
        .mockResolvedValueOnce({}); // COMMIT

      const req = { params: { id: '1' } };
      const res = buildRes();

      await deleteOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.json).toHaveBeenCalledWith({ message: 'Order deleted successfully' });
    });
  });

  describe('markOrderAsPaid', () => {
    it('marks order as paid', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // update orders
        .mockResolvedValueOnce({}); // COMMIT

      const req = { body: { order_id: 1, type: 'sale' } };
      const res = buildRes();

      await markOrderAsPaid(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Order marked as paid successfully' });
    });
  });

  describe('getCategories', () => {
    it('returns categories', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ category: 'A' }] });
      const req = {};
      const res = buildRes();

      await getCategories(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: [{ category: 'A' }] });
    });
  });

  describe('syncOfflineOrders', () => {
    it('returns 400 when orders missing', async () => {
      const req = { body: {} };
      const res = buildRes();

      await syncOfflineOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'orders must be a non-empty array.' });
    });

    it('marks duplicate in batch', async () => {
      const req = {
        body: {
          orders: [
            { client_order_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', user_id: 1, transaction_type: 'personal', total_amount: 10, payment_mode: 'cash' },
            { client_order_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', user_id: 1, transaction_type: 'personal', total_amount: 10, payment_mode: 'cash' }
          ]
        }
      };
      const res = buildRes();

      await syncOfflineOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].results[1].status).toBe('failed');
    });

    it('returns duplicate when client_order_id already exists', async () => {
      const client = buildClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 5, order_status: 'pending' }] }); // existing

      const req = {
        body: {
          orders: [
            { client_order_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', user_id: 1, transaction_type: 'personal', total_amount: 10, payment_mode: 'cash' }
          ]
        }
      };
      const res = buildRes();

      await syncOfflineOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        sync_id: null,
        results: [
          {
            client_order_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
            status: 'duplicate',
            order_id: 5,
            order_status: 'pending'
          }
        ]
      });
    });
  });
});
