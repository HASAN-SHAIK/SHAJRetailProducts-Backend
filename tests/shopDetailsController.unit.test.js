const pool = require('../src/db');

const { getMyShopDetails } = require('../src/controllers/shopDetailsController');

jest.mock('../src/db', () => ({
  query: jest.fn()
}));

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('shopDetailsController unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when user is missing', async () => {
    const req = {};
    const res = buildRes();

    await getMyShopDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Access Denied' });
  });

  it('returns 404 when no shop details found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const req = { user: { id: 7 } };
    const res = buildRes();

    await getMyShopDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Shop details not found' });
  });

  it('returns shop details when found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, shop_name: 'Test Shop' }] });
    const req = { user: { id: 7 } };
    const res = buildRes();

    await getMyShopDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      shop_details: { id: 1, shop_name: 'Test Shop' }
    });
  });

  it('returns 500 on error', async () => {
    pool.query.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: { id: 7 } };
    const res = buildRes();

    await getMyShopDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'db fail' });
  });
});
