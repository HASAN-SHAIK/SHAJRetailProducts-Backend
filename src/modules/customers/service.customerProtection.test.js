const { createCustomer, updateCustomer } = require('./service');
const { canManageCustomerFinancials, CUSTOMER_FINANCIAL_WRITE } = require('./financialPolicy');
const { customerBodySchema, customerUpdateSchema } = require('../../api/v1/modules/customers/customer.validation');

const result = (rows = []) => ({ rows, rowCount: rows.length });

// Routes queries by SQL text so tests do not depend on call order.
const makePool = ({ existing = [], current = null, inserted = null } = {}) => {
  const calls = [];
  const release = jest.fn();
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/INSERT INTO customers/.test(sql)) return result([inserted || { id: 1, credit_limit: params[7], current_balance: 0 }]);
    if (/FROM customers\s+WHERE regexp_replace/.test(sql)) return result(existing);
    if (/SELECT \* FROM customers WHERE id/.test(sql)) return result(current ? [current] : []);
    if (/UPDATE customers/.test(sql)) return result([{ ...(current || {}), id: params[18] }]);
    return result([]);
  });
  const client = { query, release };
  return { query, connect: jest.fn(async () => client), calls, release };
};

const sqlOf = (pool) => pool.calls.map((c) => c.sql);
const find = (pool, re) => pool.calls.find((c) => re.test(c.sql));

describe('financial policy', () => {
  test('only admin holds customers:financial:write', () => {
    expect(CUSTOMER_FINANCIAL_WRITE).toBe('customers:financial:write');
    expect(canManageCustomerFinancials({ role: 'admin' })).toBe(true);
    for (const role of ['manager', 'staff', 'cashier', 'unknown']) {
      expect(canManageCustomerFinancials({ role })).toBe(false);
    }
    expect(canManageCustomerFinancials(null)).toBe(false);
    expect(canManageCustomerFinancials(undefined)).toBe(false);
  });
});

describe('createCustomer financial protection', () => {
  test('service default is deny: credit_limit ignored and reported, balance never written', async () => {
    const pool = makePool();
    const row = await createCustomer(pool, { name: 'A', phone: '9000000001', credit_limit: 5000, current_balance: 900 });
    const insert = find(pool, /INSERT INTO customers/);
    expect(insert.params[7]).toBe(0);
    expect(insert.params).not.toContain(900);
    expect(insert.sql).toMatch(/\$8, 0,/);
    expect(row.ignored_fields).toEqual(['credit_limit']);
  });

  test.each(['manager', 'staff', 'cashier'])('%s-style caller (no financial right) cannot set credit_limit', async () => {
    const pool = makePool();
    const row = await createCustomer(pool, { name: 'A', phone: '9000000001', credit_limit: 100 }, { canManageFinancials: false });
    expect(find(pool, /INSERT INTO customers/).params[7]).toBe(0);
    expect(row.ignored_fields).toEqual(['credit_limit']);
  });

  test('admin may set credit_limit but still never current_balance', async () => {
    const pool = makePool();
    const row = await createCustomer(
      pool,
      { name: 'A', phone: '9000000001', credit_limit: 2500, current_balance: 777 },
      { canManageFinancials: true }
    );
    const insert = find(pool, /INSERT INTO customers/);
    expect(insert.params[7]).toBe(2500);
    expect(insert.params).not.toContain(777);
    expect(row.ignored_fields).toBeUndefined();
  });

  test('no credit_limit sent: nothing reported as ignored', async () => {
    const pool = makePool();
    const row = await createCustomer(pool, { name: 'A', phone: '9000000001' });
    expect(row.ignored_fields).toBeUndefined();
  });
});

describe('createCustomer duplicate mobile', () => {
  test('existing mobile answers 409 DUPLICATE_CUSTOMER, writes nothing and rolls back', async () => {
    const existing = { id: 9, name: 'Old', phone: '+91 90000 00001', type: 'wholesale', credit_limit: 800, current_balance: 120 };
    const pool = makePool({ existing: [existing] });

    await expect(createCustomer(pool, { name: 'New', phone: '90000-00001' })).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_CUSTOMER',
      details: { existing_customer: existing },
    });

    const sqls = sqlOf(pool);
    expect(sqls.some((s) => /INSERT INTO customers|UPDATE customers/.test(s))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(pool.release).toHaveBeenCalledTimes(1);
  });

  test('takes a per-phone advisory lock inside the transaction before the lookup', async () => {
    const pool = makePool();
    await createCustomer(pool, { name: 'A', phone: '90000 00001' });
    const sqls = sqlOf(pool);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    expect(pool.calls[1].params).toEqual(['customer-phone:9000000001']);
    expect(sqls.indexOf('COMMIT')).toBeGreaterThan(sqls.findIndex((s) => /INSERT INTO customers/.test(s)));
  });

  test('digits-only comparison uses a literal \\D in SQL', async () => {
    const pool = makePool();
    await createCustomer(pool, { name: 'A', phone: '9000000001' });
    const lookup = find(pool, /regexp_replace/);
    expect(lookup.sql).toContain("'\\D'");
    expect(lookup.params[0]).toBe('9000000001');
  });
});

describe('updateCustomer', () => {
  const current = {
    id: 5, name: 'Cust', phone: '9000000005', mobile: '9000000005', type: 'wholesale',
    credit_limit: 400, current_balance: 60, email: 'a@b.c', notes: 'n', is_active: true,
  };

  test('changing phone to another customer\'s answers 409 and does not update', async () => {
    const pool = makePool({ current, existing: [{ id: 6, name: 'Other', phone: '9000000006' }] });
    await expect(updateCustomer(pool, 5, { phone: '9000000006' })).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_CUSTOMER',
      details: { existing_customer: { id: 6 } },
    });
    const sqls = sqlOf(pool);
    expect(sqls.some((s) => /UPDATE customers/.test(s))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
    const lookup = find(pool, /regexp_replace/);
    expect(lookup.params).toEqual(['9000000006', 5]);
  });

  test('unchanged phone skips the duplicate check so existing duplicate pairs stay editable', async () => {
    const pool = makePool({ current });
    await updateCustomer(pool, 5, { name: 'Renamed', phone: '90000 00005' });
    expect(find(pool, /regexp_replace/)).toBeUndefined();
    expect(find(pool, /UPDATE customers/)).toBeDefined();
  });

  test('non-financial callers cannot change credit_limit; it is reported as ignored', async () => {
    const pool = makePool({ current });
    const row = await updateCustomer(pool, 5, { name: 'X', credit_limit: 99999, current_balance: 1 });
    const update = find(pool, /UPDATE customers/);
    expect(update.params[4]).toBe(400);
    expect(update.sql).not.toMatch(/current_balance/);
    expect(update.params).not.toContain(1);
    expect(row.ignored_fields).toEqual(['credit_limit']);
  });

  test('admin can change credit_limit; omitted credit_limit stays unchanged', async () => {
    const pool = makePool({ current });
    await updateCustomer(pool, 5, { name: 'X', credit_limit: 1200 }, { canManageFinancials: true });
    expect(find(pool, /UPDATE customers/).params[4]).toBe(1200);

    const pool2 = makePool({ current });
    await updateCustomer(pool2, 5, { name: 'X' }, { canManageFinancials: true });
    expect(find(pool2, /UPDATE customers/).params[4]).toBe(400);
  });

  test('returns null for a missing customer', async () => {
    const pool = makePool({ current: null });
    await expect(updateCustomer(pool, 404, { name: 'X' })).resolves.toBeNull();
  });

  test('uses no interpolated SQL: CASE flags and parameters only', async () => {
    const pool = makePool({ current });
    await updateCustomer(pool, 5, { name: 'X' });
    const update = find(pool, /UPDATE customers/);
    expect(update.sql).not.toContain('${');
    expect(update.sql).toMatch(/CASE WHEN \$7::boolean/);
  });
});

describe('clearing optional fields', () => {
  const current = { id: 5, name: 'Cust', phone: '9000000005', type: 'retail', credit_limit: 0 };
  // params layout: [name, phone, mobile, type, credit, active, then (flag,value) pairs, id]
  const pairs = { email: 6, shop_name: 8, gst_number: 10, notes: 12, location: 14, address: 16 };

  test('explicit empty string clears every optional field', async () => {
    const pool = makePool({ current });
    await updateCustomer(pool, 5, { email: '', notes: '  ', shop_name: '', gst_number: '', address: '', location: '' });
    const { params } = find(pool, /UPDATE customers/);
    for (const idx of Object.values(pairs)) {
      expect(params[idx]).toBe(true);
      expect(params[idx + 1]).toBeNull();
    }
  });

  test('omitted and null preserve the stored value', async () => {
    const pool = makePool({ current });
    await updateCustomer(pool, 5, { name: 'X', email: null, notes: null });
    const { params } = find(pool, /UPDATE customers/);
    for (const idx of Object.values(pairs)) expect(params[idx]).toBe(false);
  });

  test('non-empty values are set (trimmed)', async () => {
    const pool = makePool({ current });
    await updateCustomer(pool, 5, { email: ' z@y.in ', shopName: 'Shop' });
    const { params } = find(pool, /UPDATE customers/);
    expect(params.slice(6, 8)).toEqual([true, 'z@y.in']);
    expect(params.slice(8, 10)).toEqual([true, 'Shop']);
  });
});

describe('v1 validation has no silent defaults on update', () => {
  test('omitted credit_limit and type stay undefined on update', () => {
    const { value, error } = customerUpdateSchema.validate({ name: 'X' });
    expect(error).toBeUndefined();
    expect(value).toEqual({ name: 'X' });
    expect(value.credit_limit).toBeUndefined();
    expect(value.type).toBeUndefined();
  });

  test('create schema no longer injects credit_limit/type either', () => {
    const { value, error } = customerBodySchema.validate({ name: 'X' });
    expect(error).toBeUndefined();
    expect(value.credit_limit).toBeUndefined();
    expect(value.type).toBeUndefined();
  });
});
