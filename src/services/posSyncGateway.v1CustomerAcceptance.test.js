jest.mock('../messaging/sync/syncOperation.service', () => ({
  processOperationInline: jest.fn(),
}));

const { getPosChanges } = require('./posSyncGateway');

describe('V1 Customers Central to POS change-feed acceptance', () => {
  test('publishes canonical lifecycle, contact, financial snapshots and known POS-local mappings', async () => {
    const updatedAt = new Date('2026-08-15T04:15:00.000Z');
    const tenantPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          id: 42,
          name: 'Hasan Updated',
          phone: '9000000000',
          email: 'central@example.com',
          tax_id: 'GST-CENTRAL',
          credit_limit: '150.25',
          current_balance: '20.50',
          is_active: false,
          pos_mappings: [
            { id: 'cus-device-a', source_version: 3 },
            { id: 'cus-device-b', source_version: 7 },
          ],
          updated_at: updatedAt,
        }] }),
    };

    const result = await getPosChanges({ tenantPool, limit: 10, branchId: 'branch-1' });

    expect(result.changes).toEqual([{
      id: `customer:42:${updatedAt.toISOString()}`,
      type: 'customer.upsert',
      schema_version: 1,
      source: 'central',
      payload: {
        id: '42',
        canonical_id: '42',
        pos_mappings: [
          { id: 'cus-device-a', source_version: 3 },
          { id: 'cus-device-b', source_version: 7 },
        ],
        customer_code: null,
        name: 'Hasan Updated',
        phone: '9000000000',
        email: 'central@example.com',
        tax_id: 'GST-CENTRAL',
        credit_limit_minor: 15025,
        outstanding_minor: 2050,
        currency: 'INR',
        status: 'inactive',
        source_updated_at: updatedAt.toISOString(),
      },
    }]);

    const customerQuery = tenantPool.query.mock.calls[1][0];
    expect(customerQuery).toContain('pos_customer_mappings');
    expect(customerQuery).toContain("'source_version', m.source_version");
    expect(customerQuery).toContain('c.email');
    expect(customerQuery).toContain('c.gst_number AS tax_id');
    expect(customerQuery).toContain('COALESCE(c.is_active, TRUE) AS is_active');
  });

  test('publishes a stable canonical identity when the customer has no POS-local mapping', async () => {
    const updatedAt = new Date('2026-08-15T04:16:00.000Z');
    const tenantPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          id: 99,
          name: 'Central Only',
          phone: null,
          email: null,
          tax_id: null,
          credit_limit: '0',
          current_balance: '0',
          is_active: true,
          pos_mappings: [],
          updated_at: updatedAt,
        }] }),
    };

    const result = await getPosChanges({ tenantPool, limit: 10, branchId: 'branch-1' });
    expect(result.changes[0]).toMatchObject({
      type: 'customer.upsert',
      payload: { id: '99', canonical_id: '99', pos_mappings: [], status: 'active' },
    });
  });
});
