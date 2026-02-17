const pool = require('../src/db');
const { getAuthUser } = require('../src/utils/auth');

const {
  getSalesReport,
  getInventoryReport,
  getProfitReport,
  getDailySalesReport,
  getProfitGraph
} = require('../src/controllers/reportController');

jest.mock('../src/db', () => ({
  query: jest.fn()
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

describe('reportController unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSalesReport', () => {
    it('returns 401 when not authenticated', async () => {
      getAuthUser.mockReturnValue(null);
      const req = { query: {} };
      const res = buildRes();

      await getSalesReport(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access Denied' });
    });

    it('returns non-admin message', async () => {
      getAuthUser.mockReturnValue({ role: 'staff' });
      const req = { query: {} };
      const res = buildRes();

      await getSalesReport(req, res);

      expect(res.json).toHaveBeenCalledWith({ message: 'Haha! You are not admin :)' });
    });

    it('returns sales metrics for admin', async () => {
      getAuthUser.mockReturnValue({ role: 'admin' });
      pool.query
        .mockResolvedValueOnce({ rows: [{ total_revenue: 1000 }] })
        .mockResolvedValueOnce({ rows: [{ total_orders: 5 }] })
        .mockResolvedValueOnce({ rows: [{ total_cost: 700 }] })
        .mockResolvedValueOnce({ rows: [{ Name: 'Tea' }] })
        .mockResolvedValueOnce({ rows: [{ Name: 'Tea', Profit: 300 }] });

      const req = { query: { from_date: '2025-01-01', to_date: '2025-01-31' } };
      const res = buildRes();

      await getSalesReport(req, res);

      expect(res.json).toHaveBeenCalledWith({
        total_revenue: 1000,
        total_orders: 5,
        totalProfit: 300,
        bestSellingProducts: [{ Name: 'Tea' }],
        profitByProduct: [{ Name: 'Tea', Profit: 300 }]
      });
    });
  });

  describe('getInventoryReport', () => {
    it('returns inventory data for admin', async () => {
      getAuthUser.mockReturnValue({ role: 'admin' });
      pool.query
        .mockResolvedValueOnce({ rows: [{ total_stock: 50 }] })
        .mockResolvedValueOnce({ rows: [{ ProductId: 1 }] })
        .mockResolvedValueOnce({ rows: [{ ProductId: 2 }] })
        .mockResolvedValueOnce({ rows: [{ total_inventory_value: 1000 }] })
        .mockResolvedValueOnce({ rows: [{ total_inventory_actual_value: 700 }] });

      const req = { query: { threshold: 3 } };
      const res = buildRes();

      await getInventoryReport(req, res);

      expect(res.json).toHaveBeenCalledWith({
        total_stock: 50,
        low_stock_products: [{ ProductId: 1 }],
        out_of_stock_products: [{ ProductId: 2 }],
        total_inventory_value: 1000,
        total_inventory_actual_value: 700,
        estimatedProfit: 300
      });
    });

    it('returns limited data for non-admin', async () => {
      getAuthUser.mockReturnValue({ role: 'staff' });
      pool.query
        .mockResolvedValueOnce({ rows: [{ total_stock: 2 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_inventory_value: 100 }] })
        .mockResolvedValueOnce({ rows: [{ total_inventory_actual_value: 80 }] });

      const req = { query: {} };
      const res = buildRes();

      await getInventoryReport(req, res);

      expect(res.json).toHaveBeenCalledWith({
        total_stock: 2,
        low_stock_products: [],
        out_of_stock_products: [],
        total_inventory_value: null,
        total_inventory_actual_value: 80,
        estimatedProfit: null
      });
    });

    it('returns 500 on error', async () => {
      pool.query.mockRejectedValueOnce(new Error('db fail'));
      const req = { query: {} };
      const res = buildRes();

      await getInventoryReport(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'Internal server error' });
    });
  });

  describe('getProfitReport', () => {
    it('returns profit report for admin', async () => {
      getAuthUser.mockReturnValue({ role: 'admin' });
      pool.query
        .mockResolvedValueOnce({ rows: [{ total_revenue: 500 }] })
        .mockResolvedValueOnce({ rows: [{ total_profit: 120 }] })
        .mockResolvedValueOnce({ rows: [{ total_products: 9 }] });

      const req = { query: { from_date: '2025-01-01', to_date: '2025-01-31' } };
      const res = buildRes();

      await getProfitReport(req, res);

      expect(res.json).toHaveBeenCalledWith({
        total_revenue: 500,
        total_profit: 120,
        total_products: 9,
        from_date: '2025-01-01',
        to_date: '2025-01-31'
      });
    });

    it('returns non-admin message', async () => {
      getAuthUser.mockReturnValue({ role: 'staff' });
      const req = { query: {} };
      const res = buildRes();

      await getProfitReport(req, res);

      expect(res.json).toHaveBeenCalledWith({ message: 'Haha! You are not admin :)' });
    });
  });

  describe('getDailySalesReport', () => {
    it('returns daily sales metrics for admin', async () => {
      getAuthUser.mockReturnValue({ role: 'admin' });
      pool.query
        .mockResolvedValueOnce({ rows: [{ total_revenue: 250 }] })
        .mockResolvedValueOnce({ rows: [{ total_orders: 3 }] })
        .mockResolvedValueOnce({ rows: [{ name: 'Tea', total_sold: 5 }] })
        .mockResolvedValueOnce({ rows: [{ total_profit: 60 }] });

      const date = new Date('2025-01-15T00:00:00Z');
      const req = { query: { date } };
      const res = buildRes();

      await getDailySalesReport(req, res);

      expect(res.json).toHaveBeenCalledWith({
        date,
        total_revenue: 250,
        profit: 60,
        total_orders: 3,
        best_selling_products: [{ name: 'Tea', total_sold: 5 }]
      });
    });
  });

  describe('getProfitGraph', () => {
    it('returns profit graph data for admin', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-02-01T12:00:00Z'));
      getAuthUser.mockReturnValue({ role: 'admin' });
      pool.query.mockResolvedValueOnce({
        rows: [{ day: new Date(Date.UTC(2025, 0, 10)), profit: '12.5' }]
      });

      const req = { query: {} };
      const res = buildRes();

      await getProfitGraph(req, res);

      const payload = res.json.mock.calls[0][0];
      const index = payload.labels.indexOf('2025-01-10');

      expect(payload.range_days).toBe(30);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(payload.data[index]).toBe(12.5);

      jest.useRealTimers();
    });
  });
});
