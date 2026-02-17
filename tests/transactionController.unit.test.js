const pool = require('../src/db');
const { getAuthUser } = require('../src/utils/auth');

const {
  createTransaction,
  getAllTransactions,
  rollbackTransaction
} = require('../src/controllers/transactionController');

jest.mock('../src/db', () => ({
  query: jest.fn(),
  connect: jest.fn()
}));

jest.mock('../src/utils/auth', () => ({
  getAuthUser: jest.fn()
}));

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const buildClient = () => ({
  query: jest.fn(),
  release: jest.fn()
});

describe('transactionController unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTransaction', () => {
    it('creates a transaction and marks order completed', async () => {
      const client = buildClient();
      client.query.mockImplementation((sql) => {
        if (/BEGIN/i.test(sql)) return Promise.resolve();
        if (/SELECT total_price/i.test(sql)) {
          return Promise.resolve({ rows: [{ total_price: 50, order_status: 'pending' }] });
        }
        if (/INSERT INTO transactions/i.test(sql)) {
          return Promise.resolve({ rows: [{ id: 101 }] });
        }
        if (/UPDATE orders SET order_status/i.test(sql)) return Promise.resolve();
        if (/COMMIT/i.test(sql)) return Promise.resolve();
        return Promise.resolve();
      });
      pool.connect.mockResolvedValue(client);

      const req = { body: { order_id: 1, payment_method: 'cash', amount_paid: 50 } };
      const res = buildRes();

      await createTransaction(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ message: 'Payment successful', transactionId: 101 });
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('rolls back when order not found', async () => {
      const client = buildClient();
      client.query.mockImplementation((sql) => {
        if (/BEGIN/i.test(sql)) return Promise.resolve();
        if (/SELECT total_price/i.test(sql)) return Promise.resolve({ rows: [] });
        if (/ROLLBACK/i.test(sql)) return Promise.resolve();
        return Promise.resolve();
      });
      pool.connect.mockResolvedValue(client);

      const req = { body: { order_id: 1, payment_method: 'cash', amount_paid: 50 } };
      const res = buildRes();

      await createTransaction(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Order ID 1 not found' });
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('getAllTransactions', () => {
    it('returns 401 when not authenticated', async () => {
      getAuthUser.mockReturnValue(null);
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ profit: 0 }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] });
      const req = {};
      const res = buildRes();

      await getAllTransactions(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access Denied' });
    });

    it('returns totals for admin', async () => {
      getAuthUser.mockReturnValue({ role: 'admin' });
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '100' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '200' }] })
        .mockResolvedValueOnce({ rows: [{ profit: 55 }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '10' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '40' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '20' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '30' }] });

      const req = {};
      const res = buildRes();

      await getAllTransactions(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        total_cash: 70,
        total_online: 130,
        total_income: 200,
        profit: 55,
        transactions: [{ id: 1 }]
      });
    });

    it('returns limited response for non-admin', async () => {
      getAuthUser.mockReturnValue({ role: 'staff' });
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ profit: 0 }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_cash: '0' }] });

      const req = {};
      const res = buildRes();

      await getAllTransactions(req, res);

      expect(res.json).toHaveBeenCalledWith({
        transactions: [{ id: 1 }],
        message: 'Haha! You are not admin :)'
      });
    });
  });

  describe('rollbackTransaction', () => {
    it('rolls back transaction successfully', async () => {
      const client = buildClient();
      client.query.mockImplementation((sql) => {
        if (/BEGIN/i.test(sql)) return Promise.resolve();
        if (/SELECT order_id, total_price/i.test(sql)) {
          return Promise.resolve({ rows: [{ order_id: 9, total_price: 80 }] });
        }
        if (/SELECT id FROM transactions WHERE order_id/i.test(sql)) {
          return Promise.resolve({ rows: [] });
        }
        if (/INSERT INTO transactions/i.test(sql)) {
          return Promise.resolve({ rows: [{ id: 201 }] });
        }
        if (/UPDATE orders SET order_status/i.test(sql)) return Promise.resolve();
        if (/COMMIT/i.test(sql)) return Promise.resolve();
        return Promise.resolve();
      });
      pool.connect.mockResolvedValue(client);

      const req = { body: { transaction_id: 4 } };
      const res = buildRes();

      await rollbackTransaction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Transaction rolled back successfully',
        refundTransactionId: 201
      });
    });

    it('returns 400 when already refunded', async () => {
      const client = buildClient();
      client.query.mockImplementation((sql) => {
        if (/BEGIN/i.test(sql)) return Promise.resolve();
        if (/SELECT order_id, total_price/i.test(sql)) {
          return Promise.resolve({ rows: [{ order_id: 9, total_price: 80 }] });
        }
        if (/SELECT id FROM transactions WHERE order_id/i.test(sql)) {
          return Promise.resolve({ rows: [{ id: 1 }] });
        }
        if (/ROLLBACK/i.test(sql)) return Promise.resolve();
        return Promise.resolve();
      });
      pool.connect.mockResolvedValue(client);

      const req = { body: { transaction_id: 4 } };
      const res = buildRes();

      await rollbackTransaction(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Transaction already refunded' });
    });
  });
});
