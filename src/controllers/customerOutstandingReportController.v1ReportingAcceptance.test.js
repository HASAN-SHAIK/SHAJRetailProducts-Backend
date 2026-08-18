jest.mock('../db', () => ({ query: jest.fn(() => { throw new Error('default pool must not be used'); }) }));

const { getCustomerOutstandingReport } = require('./customerOutstandingReportController');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('V1 customer outstanding reporting acceptance', () => {
  test('reads only canonical tenant customer balances with bounded pagination', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 7, name: 'High Balance', current_balance: '400.00', credit_limit: '1000.00', is_active: true },
          { id: 3, name: 'Lower Balance', current_balance: '125.00', credit_limit: '500.00', is_active: true },
        ],
      });
    const req = { tenantPool: { query }, query: { page: '2', limit: '9999' } };
    const res = makeRes();

    await getCustomerOutstandingReport(req, res);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('FROM customers');
    expect(query.mock.calls[0][0]).toContain('current_balance');
    expect(query.mock.calls[1][0]).toContain('ORDER BY current_balance DESC');
    expect(query.mock.calls[1][1]).toEqual([200, 200]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      customers: expect.arrayContaining([
        expect.objectContaining({ id: 7, current_balance: '400.00' }),
        expect.objectContaining({ id: 3, current_balance: '125.00' }),
      ]),
      pagination: { page: 2, limit: 200, total: 2, total_pages: 1 },
    });
  });

  test('never derives outstanding from POS/browser snapshots or order arithmetic in the report query', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const req = { tenantPool: { query }, query: {} };
    const res = makeRes();

    await getCustomerOutstandingReport(req, res);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n').toLowerCase();
    expect(sql).toContain('customers');
    expect(sql).toContain('current_balance');
    expect(sql).not.toContain('pos_customers');
    expect(sql).not.toContain('orders');
    expect(sql).not.toContain('customer_payments');
  });
});
