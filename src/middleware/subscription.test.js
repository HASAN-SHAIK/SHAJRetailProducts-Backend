const mockQuery = jest.fn();
jest.mock('../db/masterPool', () => ({ query: (...a) => mockQuery(...a) }));

const { subscriptionMiddleware } = require('./subscription');
const { clearCachedSubscription } = require('../config/subscriptionCache');
const { buildSubscriptionInfo } = require('../services/subscriptionStatusService');

const DAY = 24 * 60 * 60 * 1000;
const run = async (rows) => {
  clearCachedSubscription(1);
  mockQuery.mockResolvedValueOnce({ rowCount: rows.length, rows });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  const req = { path: '/orders', user: { tenant_id: 1 } };
  await subscriptionMiddleware(req, res, next);
  return { res, next, req };
};

describe('subscription guard', () => {
  beforeEach(() => mockQuery.mockReset());

  test('query accepts paid and trial statuses', async () => {
    await run([]);
    expect(mockQuery.mock.calls[0][0]).toMatch(/payment_status IN \('paid', 'trial'\)/);
  });

  test.each(['trial', 'paid'])('valid %s subscription passes', async (status) => {
    const { next, res } = await run([{ payment_status: status, end_date: new Date(Date.now() + 3 * DAY) }]);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test.each(['trial', 'paid'])('expired %s subscription gets 402', async (status) => {
    const { next, res } = await run([{ payment_status: status, end_date: new Date(Date.now() - DAY) }]);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
  });

  test('no subscription gets 402', async () => {
    const { next, res } = await run([]);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
  });
});

describe('buildSubscriptionInfo', () => {
  const now = new Date('2026-01-10T00:00:00Z');
  test('trial / paid / expired / none', () => {
    expect(buildSubscriptionInfo({ payment_status: 'trial', end_date: '2026-01-15T00:00:00Z' }, now))
      .toEqual({ status: 'trial', ends_at: '2026-01-15T00:00:00Z', days_left: 5 });
    expect(buildSubscriptionInfo({ payment_status: 'paid', end_date: '2026-02-09T00:00:00Z' }, now).status).toBe('paid');
    expect(buildSubscriptionInfo({ payment_status: 'trial', end_date: '2026-01-01T00:00:00Z' }, now))
      .toMatchObject({ status: 'expired', days_left: 0 });
    expect(buildSubscriptionInfo(null, now).status).toBe('none');
  });
});
