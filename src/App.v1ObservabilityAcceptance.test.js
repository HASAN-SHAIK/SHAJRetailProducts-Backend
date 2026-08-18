const request = require('supertest');

jest.mock('./db/masterPool', () => ({
  query: jest.fn(),
}));

const masterPool = require('./db/masterPool');
const app = require('./App');

describe('V1 Central health and readiness boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.HEALTH_WARMUP_KEY;
  });

  test.each(['/ready', '/api/ready'])('returns ready only when required PostgreSQL dependency is available at %s', async (path) => {
    masterPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(masterPool.query).toHaveBeenCalledWith('SELECT 1');
  });

  test.each(['/ready', '/api/ready'])('fails closed without leaking database details at %s', async (path) => {
    masterPool.query.mockRejectedValueOnce(
      new Error('password=secret postgresql://admin:secret@db.internal:5432/master')
    );

    const response = await request(app).get(path);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', reason: 'database_unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(JSON.stringify(response.body)).not.toContain('db.internal');
  });

  test('keeps ordinary liveness independent from PostgreSQL and does not warm DB without authorization', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.db).toMatchObject({
      warm_requested: false,
      warmed: false,
      reason: 'not_requested',
    });
    expect(masterPool.query).not.toHaveBeenCalled();
  });

  test('does not query PostgreSQL for an unauthorized warmup request', async () => {
    process.env.HEALTH_WARMUP_KEY = 'expected-key';

    const response = await request(app).get('/health?warm_db=1');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.db).toMatchObject({
      warm_requested: true,
      warmed: false,
      reason: 'unauthorized',
    });
    expect(masterPool.query).not.toHaveBeenCalled();
  });
});
