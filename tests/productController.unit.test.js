const pool = require('../src/db');
const { getAuthUser } = require('../src/utils/auth');

const {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  searchProducts
} = require('../src/controllers/productController');

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

describe('productController unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProducts', () => {
    it('returns 401 when not authenticated', async () => {
      getAuthUser.mockReturnValue(null);
      const req = { query: {} };
      const res = buildRes();

      await getProducts(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access Denied' });
    });

    it('returns products for admin with actual_price', async () => {
      getAuthUser.mockReturnValue({ role: 'admin' });
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      const req = { query: {} };
      const res = buildRes();

      await getProducts(req, res);

      const sql = pool.query.mock.calls[0][0];
      expect(sql).toMatch(/actual_price/i);
      expect(sql).toMatch(/order by name/i);
      expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
    });

    it('returns products for non-admin without actual_price', async () => {
      getAuthUser.mockReturnValue({ role: 'staff' });
      pool.query.mockResolvedValueOnce({ rows: [] });
      const req = { query: { sort: 'company' } };
      const res = buildRes();

      await getProducts(req, res);

      const sql = pool.query.mock.calls[0][0];
      expect(sql).not.toMatch(/actual_price/i);
      expect(sql).toMatch(/order by company/i);
      expect(res.json).toHaveBeenCalledWith([]);
    });
  });

  describe('addProduct', () => {
    it('updates existing product stock and prices', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 7, is_weight_based: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Rice' }] });

      const req = {
        body: {
          product_name: 'Rice',
          category: 'Grocery',
          selling_price: 55,
          stock_quantity: 10,
          company: 'Acme',
          actual_price: 40,
          time_for_delivery: 2
        }
      };
      const res = buildRes();

      await addProduct(req, res);

      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/update products/i),
        [10, 40, 55, 1, 7]
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Product already exists. Stock and prices updated.',
        product: { id: 7, name: 'Rice' }
      });
    });

    it('inserts a new product when not existing', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 11, name: 'Soap' }] });

      const req = {
        body: {
          product_name: 'Soap',
          category: 'Home',
          selling_price: 30,
          stock_quantity: 5,
          company: 'CleanCo',
          actual_price: 20,
          time_for_delivery: 1,
          is_weight_based: 0
        }
      };
      const res = buildRes();

      await addProduct(req, res);

      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/insert into products/i),
        ['Soap', 'Home', 30, 5, 20, 'CleanCo', 1, 0]
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'New product added.',
        product: { id: 11, name: 'Soap' }
      });
    });

    it('returns 500 on error', async () => {
      pool.query.mockRejectedValueOnce(new Error('db fail'));
      const req = { body: { product_name: 'X', company: 'Y' } };
      const res = buildRes();

      await addProduct(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Database error' });
    });
  });

  describe('updateProduct', () => {
    it('updates product using existing values as fallback', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 3,
              name: 'Oil',
              company: 'Acme',
              selling_price: 100,
              actual_price: 80,
              stock_quantity: 15,
              is_weight_based: 0
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [{ id: 3, name: 'Oil' }] });

      const req = { params: { id: 3 }, body: { selling_price: 110 } };
      const res = buildRes();

      await updateProduct(req, res);

      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/update products/i),
        ['Oil', 'Acme', 110, 80, 15, 0, 3]
      );
      expect(res.json).toHaveBeenCalledWith({ id: 3, name: 'Oil' });
    });

    it('returns 500 on error', async () => {
      pool.query.mockRejectedValueOnce(new Error('db fail'));
      const req = { params: { id: 1 }, body: {} };
      const res = buildRes();

      await updateProduct(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: expect.any(Error), message: 'Database error' });
    });
  });

  describe('deleteProduct', () => {
    it('soft deletes the product', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const req = { params: { id: 9 } };
      const res = buildRes();

      await deleteProduct(req, res);

      expect(pool.query).toHaveBeenCalledWith('UPDATE products SET is_deleted = true WHERE id = $1', [9]);
      expect(res.json).toHaveBeenCalledWith({ message: 'Product deleted' });
    });
  });

  describe('searchProducts', () => {
    it('returns 400 when name missing', async () => {
      const req = { query: {} };
      const res = buildRes();

      await searchProducts(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Product name is required for search.' });
    });

    it('returns matching products', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Tea' }] });
      const req = { query: { name: 'tea' } };
      const res = buildRes();

      await searchProducts(req, res);

      expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/select \*/i), ['%tea%']);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ products: [{ id: 1, name: 'Tea' }] });
    });

    it('returns 500 on error', async () => {
      pool.query.mockRejectedValueOnce(new Error('db fail'));
      const req = { query: { name: 'tea' } };
      const res = buildRes();

      await searchProducts(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
    });
  });
});
