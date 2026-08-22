const {
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomerById,
} = require('./service');

const result = (rows = []) => ({ rows, rowCount: rows.length });

const makePool = (responses = []) => {
  const query = jest.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  return { query };
};

describe('V1 Central customer CRUD authority and tenant-global scope', () => {
  test('create and update remain inside the supplied tenant pool', async () => {
    const tenantA = makePool([
      result([]),
      result([{ id: 11, name: 'Asha', phone: '9000000001', credit_limit: 0, current_balance: 0 }]),
      result([{ id: 11, name: 'Asha Updated', phone: '9000000001', credit_limit: 500, current_balance: 0 }]),
    ]);
    const tenantB = makePool();

    const created = await createCustomer(tenantA, { name: 'Asha', phone: '9000000001' });
    const updated = await updateCustomer(tenantA, created.id, { name: 'Asha Updated', credit_limit: 500 });

    expect(updated.name).toBe('Asha Updated');
    expect(tenantA.query).toHaveBeenCalledTimes(3);
    expect(tenantB.query).not.toHaveBeenCalled();

    const insertSql = tenantA.query.mock.calls[1][0];
    const updateSql = tenantA.query.mock.calls[2][0];
    expect(insertSql).toContain('INSERT INTO customers');
    expect(updateSql).toContain('UPDATE customers');
    expect(insertSql).not.toMatch(/branch_id/i);
    expect(updateSql).not.toMatch(/branch_id/i);
  });

  test('partial profile updates preserve omitted type and financial projection fields', async () => {
    const tenantPool = makePool([
      result([{ id: 11, name: 'Asha Updated', type: 'wholesale', credit_limit: 750, current_balance: 125 }]),
    ]);

    await updateCustomer(tenantPool, 11, { name: 'Asha Updated', email: 'asha@example.com' });

    const [, params] = tenantPool.query.mock.calls[0];
    expect(params[3]).toBeNull();
    expect(params[7]).toBeNull();
    expect(params[8]).toBeNull();
  });

  test('customer list is tenant-global across stores and never branch-filtered', async () => {
    const tenantPool = makePool([
      result([
        { id: 1, name: 'Store One Customer' },
        { id: 2, name: 'Store Two Customer' },
      ]),
    ]);

    const rows = await listCustomers(tenantPool, { limit: 100 });

    expect(rows).toHaveLength(2);
    const [sql] = tenantPool.query.mock.calls[0];
    expect(sql).toContain('FROM customers');
    expect(sql).not.toMatch(/branch_id/i);
    expect(sql).not.toMatch(/store_id/i);
  });

  test('customer detail reads orders and payments only from the same tenant pool', async () => {
    const tenantA = makePool([
      result([{ id: 21, name: 'Tenant A Customer' }]),
      result([{ id: 301, total_price: '125.00' }]),
      result([{ id: 401, amount: '25.00' }]),
    ]);
    const tenantB = makePool();

    const detail = await getCustomerById(tenantA, 21);

    expect(detail.customer.id).toBe(21);
    expect(detail.orders).toHaveLength(1);
    expect(detail.payments).toHaveLength(1);
    expect(tenantA.query).toHaveBeenCalledTimes(3);
    expect(tenantB.query).not.toHaveBeenCalled();
    expect(tenantA.query.mock.calls[0][0]).toContain('FROM customers');
    expect(tenantA.query.mock.calls[1][0]).toContain('FROM orders');
    expect(tenantA.query.mock.calls[2][0]).toContain('FROM customer_payments');
  });

  test('same customer identifier cannot cause cross-tenant access because pools are explicit', async () => {
    const tenantA = makePool([
      result([{ id: 7, name: 'Tenant A' }]),
      result([]),
      result([]),
    ]);
    const tenantB = makePool([
      result([{ id: 7, name: 'Tenant B' }]),
      result([]),
      result([]),
    ]);

    const a = await getCustomerById(tenantA, 7);
    const b = await getCustomerById(tenantB, 7);

    expect(a.customer.name).toBe('Tenant A');
    expect(b.customer.name).toBe('Tenant B');
    expect(tenantA.query).toHaveBeenCalledTimes(3);
    expect(tenantB.query).toHaveBeenCalledTimes(3);
  });
});
