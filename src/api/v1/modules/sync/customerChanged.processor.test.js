const { processCustomerChanged } = require('./customerChanged.processor');

const customerEvent = (overrides = {}) => ({
  event_id: 'evt-customer-1-v2',
  event_type: 'customer.changed',
  schema_version: 1,
  aggregate_type: 'customer',
  aggregate_id: 'cus-offline-1',
  aggregate_version: 2,
  payload: {
    customer: {
      id: 'cus-offline-1',
      name: 'Hasan',
      phone: '90000 00000',
      email: 'hasan@example.com',
      tax_id: 'GST123',
      credit_limit_minor: 10000,
      outstanding_minor: 2500,
      currency: 'INR',
      status: 'active',
      local_version: 2,
      updated_at: '2026-08-15T00:30:00Z',
      ...overrides,
    },
  },
});

describe('customer.changed canonical projection', () => {
  test('maps an offline POS customer to Central without applying POS financial snapshots', async () => {
    const queries = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        queries.push({ text, params });
        if (text.includes('INSERT INTO pos_customers')) {
          return { rowCount: 1, rows: [{ customer_id: 'cus-offline-1', local_version: 2 }] };
        }
        if (text.includes('SELECT canonical_customer_id FROM pos_customer_mappings')) {
          const settled = queries.filter((q) => q.text.includes('SELECT canonical_customer_id FROM pos_customer_mappings')).length > 1;
          return settled
            ? { rowCount: 1, rows: [{ canonical_customer_id: 42 }] }
            : { rowCount: 0, rows: [] };
        }
        if (text.includes('FROM customers') && text.includes('regexp_replace')) {
          return { rowCount: 0, rows: [] };
        }
        if (text.includes('INSERT INTO customers')) {
          return { rowCount: 1, rows: [{ id: 42 }] };
        }
        return { rowCount: 1, rows: [] };
      }),
    };

    await expect(processCustomerChanged(client, customerEvent())).resolves.toEqual({
      customer_id: 'cus-offline-1',
      local_version: 2,
      canonical_customer_id: 42,
      canonical_applied: true,
    });

    const canonicalCreate = queries.find((q) => q.text.includes('INSERT INTO customers'));
    expect(canonicalCreate.text).toContain('credit_limit,current_balance');
    expect(canonicalCreate.text).toContain("0,0");
    expect(canonicalCreate.params).not.toContain(10000);
    expect(canonicalCreate.params).not.toContain(2500);

    const canonicalUpdate = queries.find((q) => q.text.includes('UPDATE customers'));
    expect(canonicalUpdate.text).not.toContain('credit_limit');
    expect(canonicalUpdate.text).not.toContain('current_balance');
    expect(canonicalUpdate.params).toEqual([42, 'Hasan', '9000000000', 'hasan@example.com', 'GST123', true]);

    const backfill = queries.find((q) => q.text.includes("source_channel='pos'"));
    expect(backfill.params).toEqual([42, 'cus-offline-1']);
  });

  test('reuses an existing immutable mapping on replay/update', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('INSERT INTO pos_customers')) {
          return { rowCount: 1, rows: [{ customer_id: 'cus-offline-1', local_version: 3 }] };
        }
        if (text.includes('SELECT canonical_customer_id FROM pos_customer_mappings')) {
          return { rowCount: 1, rows: [{ canonical_customer_id: 77 }] };
        }
        return { rowCount: 1, rows: [] };
      }),
    };

    const event = customerEvent({ local_version: 3, name: 'Hasan Updated' });
    event.aggregate_version = 3;
    event.event_id = 'evt-customer-1-v3';

    await expect(processCustomerChanged(client, event)).resolves.toMatchObject({
      canonical_customer_id: 77,
      canonical_applied: true,
    });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO customers'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_customer_mappings'))).toBe(false);
  });

  test('ignores a stale POS version for canonical mutation', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('INSERT INTO pos_customers')) return { rowCount: 0, rows: [] };
        if (text.includes('SELECT canonical_customer_id FROM pos_customer_mappings')) {
          return { rowCount: 1, rows: [{ canonical_customer_id: 77 }] };
        }
        throw new Error(`unexpected query: ${text}`);
      }),
    };

    const result = await processCustomerChanged(client, customerEvent());
    expect(result).toEqual({
      customer_id: 'cus-offline-1',
      local_version: 2,
      canonical_customer_id: 77,
      canonical_applied: false,
    });
    expect(client.query).toHaveBeenCalledTimes(2);
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
