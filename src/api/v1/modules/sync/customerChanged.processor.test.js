const { processCustomerChanged } = require('./customerChanged.processor');

describe('customer.changed projection', () => {
  test('projects a valid customer version', async () => {
    const client = { query: jest.fn(async () => ({ rowCount: 1, rows: [] })) };
    const event = {
      event_id: 'evt-customer-1-v2', event_type: 'customer.changed', schema_version: 1,
      aggregate_type: 'customer', aggregate_id: 'cus-1', aggregate_version: 2,
      payload: { customer: {
        id: 'cus-1', name: 'Hasan', phone: '9000000000', credit_limit_minor: 10000,
        outstanding_minor: 0, currency: 'INR', status: 'active', local_version: 2,
        updated_at: '2026-08-07T16:00:00Z'
      }}
    };

    await expect(processCustomerChanged(client, event)).resolves.toEqual({ customer_id: 'cus-1', local_version: 2 });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0][0])).toContain('INSERT INTO pos_customers');
    expect(String(client.query.mock.calls[0][0])).toContain('pos_customers.local_version <= EXCLUDED.local_version');
  });

  test('rejects aggregate version mismatch', async () => {
    const client = { query: jest.fn() };
    await expect(processCustomerChanged(client, {
      event_type: 'customer.changed', schema_version: 1, aggregate_type: 'customer', aggregate_id: 'cus-1', aggregate_version: 2,
      payload: { customer: { id: 'cus-1', local_version: 1 } }
    })).rejects.toMatchObject({ code: 'INVALID_CUSTOMER_CHANGED_PAYLOAD' });
    expect(client.query).not.toHaveBeenCalled();
  });
});
