const { createCustomer, updateCustomer } = require('./service');
const {
  canManageCustomerFinancials,
  listIgnoredFinancialFields,
} = require('./financialPolicy');
const { handleCreateCustomer, handleUpdateCustomer } = require('./controller');

const result = (rows = []) => ({ rows, rowCount: rows.length });
const makePool = (responses = []) => {
  const query = jest.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  return { query };
};

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const ROLES = ['cashier', 'staff', 'manager', 'admin'];
const AUTHORISED = { admin: true, cashier: false, staff: false, manager: false };

describe('financial policy', () => {
  test.each(ROLES)('%s financial-write permission matches the policy', (role) => {
    expect(canManageCustomerFinancials({ role })).toBe(AUTHORISED[role]);
  });

  test('no user / unknown role is denied', () => {
    expect(canManageCustomerFinancials(null)).toBe(false);
    expect(canManageCustomerFinancials({ role: 'intern' })).toBe(false);
  });

  test('ignored field listing', () => {
    const body = { credit_limit: 10, currentBalance: 5, name: 'x' };
    expect(listIgnoredFinancialFields(body, false)).toEqual(['current_balance', 'credit_limit']);
    expect(listIgnoredFinancialFields(body, true)).toEqual(['current_balance']);
    expect(listIgnoredFinancialFields({ name: 'x' }, false)).toEqual([]);
  });
});

describe('direct API manipulation of financial fields (legacy controller, real roles)', () => {
  const attack = { name: 'Asha', phone: '9000000001', credit_limit: 99999, current_balance: -500 };

  test.each(ROLES)('PUT as %s never writes current_balance; credit_limit only for admin', async (role) => {
    const pool = makePool([result([{ id: 1, name: 'Asha', credit_limit: 0, current_balance: 0 }])]);
    const req = { tenantPool: pool, user: { role }, params: { id: 1 }, body: { name: 'Asha', ...attack, phone: undefined } };
    delete req.body.phone;
    const res = makeRes();
    await handleUpdateCustomer(req, res);

    expect(res.statusCode).toBe(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/current_balance\s*=/);
    expect(params).not.toContain(-500);
    if (AUTHORISED[role]) {
      expect(params[7]).toBe(99999);
      expect(res.body.data.ignored_fields).toEqual(['current_balance']);
    } else {
      expect(params[7]).toBeNull();
      expect(res.body.data.ignored_fields).toEqual(['current_balance', 'credit_limit']);
    }
  });

  test.each(ROLES)('POST as %s always inserts balance 0; credit_limit only for admin', async (role) => {
    const pool = makePool([result([]), result([{ id: 9, name: 'Asha' }])]);
    const res = makeRes();
    await handleCreateCustomer({ tenantPool: pool, user: { role }, body: attack }, res);

    expect(res.statusCode).toBe(200);
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/\$8,0,\$9/); // literal 0 balance
    expect(params).not.toContain(-500);
    expect(params[7]).toBe(AUTHORISED[role] ? 99999 : 0);
  });

  test('camelCase aliases are blocked as well', async () => {
    const pool = makePool([result([{ id: 1 }])]);
    await updateCustomer(pool, 1, { creditLimit: 5000, currentBalance: 700 }, {});
    const [, params] = pool.query.mock.calls[0];
    expect(params[7]).toBeNull();
    expect(params).not.toContain(700);
    expect(params).not.toContain(5000);
  });

  test('service default is deny when no options are supplied', async () => {
    const pool = makePool([result([{ id: 1 }])]);
    await updateCustomer(pool, 1, { credit_limit: 5000 });
    expect(pool.query.mock.calls[0][1][7]).toBeNull();
  });
});

describe('duplicate mobile handling', () => {
  const existing = { id: 5, name: 'Existing', phone: '9876543210', credit_limit: 2500, current_balance: 300 };

  test('create with an existing mobile throws 409 and never writes', async () => {
    const pool = makePool([result([existing])]);
    await expect(
      createCustomer(pool, { name: 'Other Name', phone: '98765 43210', credit_limit: 1 }, { canManageFinancials: true })
    ).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_CUSTOMER' });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('SELECT');
    expect(pool.query.mock.calls[0][1][0]).toBe('9876543210');
    expect(pool.query.mock.calls[0][0]).toContain("'\\D'");
  });

  test('controller returns 409 with the existing customer (balance and limit intact)', async () => {
    const pool = makePool([result([existing])]);
    const res = makeRes();
    await handleCreateCustomer({ tenantPool: pool, user: { role: 'cashier' }, body: { name: 'X', phone: '9876543210' } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_CUSTOMER');
    expect(res.body.details.existing_customer).toMatchObject({ id: 5, credit_limit: 2500, current_balance: 300 });
  });

  test('changing a phone onto another customer is rejected, same phone is allowed', async () => {
    const clash = makePool([result([{ digits: '9111111111' }]), result([existing])]);
    await expect(updateCustomer(clash, 8, { phone: '9876543210' })).rejects.toMatchObject({ status: 409 });
    expect(clash.query.mock.calls.every(([sql]) => !/UPDATE customers/.test(sql))).toBe(true);

    const same = makePool([result([{ digits: '9876543210' }]), result([{ id: 5, name: 'Existing' }])]);
    await expect(updateCustomer(same, 5, { phone: '98765-43210' })).resolves.toMatchObject({ id: 5 });
  });

  test('creation is serialised with a transaction advisory lock', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql) => {
        calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
        if (/FROM customers/.test(sql)) return result([]);
        if (/INSERT/.test(sql)) return result([{ id: 1 }]);
        return result([]);
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client), query: jest.fn() };
    await createCustomer(pool, { name: 'A', phone: '9000000002' });
    expect(calls[0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
    expect(client.query.mock.calls[1][1][0]).toBe('customer-phone:9000000002');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('duplicate inside the lock rolls back and releases the client', async () => {
    const client = {
      query: jest.fn(async (sql) => (/FROM customers/.test(sql) ? result([existing]) : result([]))),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client) };
    await expect(createCustomer(pool, { name: 'A', phone: '9876543210' })).rejects.toMatchObject({ status: 409 });
    const sqls = client.query.mock.calls.map(([sql]) => sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(sqls.some((sql) => /INSERT/.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('two concurrent creates for one number: exactly one insert wins (lock emulation)', async () => {
    const rows = [];
    let tail = Promise.resolve();
    const makeClient = () => ({
      query: async (sql, params) => {
        if (sql.includes('pg_advisory_xact_lock')) return result([]);
        if (/FROM customers/.test(sql)) return result(rows.filter((r) => r.phone === params[0]));
        if (/INSERT/.test(sql)) {
          rows.push({ id: rows.length + 1, phone: params[2] });
          return result([rows[rows.length - 1]]);
        }
        return result([]);
      },
      release: () => {},
    });
    // emulate the advisory lock: connect() resolves serially per transaction
    const pool = {
      connect: () => {
        const turn = tail;
        let done;
        tail = new Promise((resolve) => (done = resolve));
        return turn.then(() => {
          const client = makeClient();
          const release = client.release;
          client.release = () => {
            release();
            done();
          };
          return client;
        });
      },
    };
    const outcomes = await Promise.allSettled([
      createCustomer(pool, { name: 'A', phone: '9000000003' }),
      createCustomer(pool, { name: 'B', phone: '9000000003' }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')[0].reason.status).toBe(409);
    expect(rows).toHaveLength(1);
  });
});

describe('optional field clearing', () => {
  test('explicit empty email/notes clear; omitted and null preserve', async () => {
    const pool = makePool([result([{ id: 1 }]), result([{ id: 1 }]), result([{ id: 1 }])]);
    await updateCustomer(pool, 1, { email: '', notes: '   ' });
    await updateCustomer(pool, 1, { name: 'Only Name' });
    await updateCustomer(pool, 1, { email: null, notes: null });

    const [cleared, omitted, nulls] = pool.query.mock.calls.map(([, params]) => params);
    // flag order: email, notes, shop_name, gst_number, address, location
    expect(cleared.slice(13, 19)).toEqual([true, true, false, false, false, false]);
    expect(omitted.slice(13, 19)).toEqual([false, false, false, false, false, false]);
    expect(nulls.slice(13, 19)).toEqual([false, false, false, false, false, false]);
    expect(pool.query.mock.calls[0][0]).toMatch(/email = CASE WHEN \$14 THEN NULL ELSE COALESCE\(\$5, email\) END/);
    expect(pool.query.mock.calls[0][0]).toMatch(/notes = CASE WHEN \$15 THEN NULL ELSE COALESCE\(\$9, notes\) END/);
  });

  test('legacy controller passes the empty string through so it can be cleared', async () => {
    const pool = makePool([result([{ id: 1 }])]);
    await handleUpdateCustomer({ tenantPool: pool, user: { role: 'cashier' }, params: { id: 1 }, body: { email: '', notes: '' } }, makeRes());
    expect(pool.query.mock.calls[0][1].slice(13, 15)).toEqual([true, true]);
  });
});

describe('v1 update validation schema', () => {
  let schema;
  try {
    ({ customerUpdateSchema: schema } = require('../../api/v1/modules/customers/customer.validation'));
  } catch (error) {
    schema = null; // joi not installed in this environment
  }
  const maybe = schema ? test : test.skip;

  maybe('applies no defaults, so omitted keys stay omitted', () => {
    const { value, error } = schema.validate({ name: 'Only Name' }, { stripUnknown: true });
    expect(error).toBeUndefined();
    expect(value).toEqual({ name: 'Only Name' });
  });

  maybe('accepts explicit empty email and notes', () => {
    const { value, error } = schema.validate({ email: '', notes: '' }, { stripUnknown: true });
    expect(error).toBeUndefined();
    expect(value).toEqual({ email: '', notes: '' });
  });

  maybe('still rejects invalid email and negative credit limit', () => {
    expect(schema.validate({ email: 'nope' }).error).toBeDefined();
    expect(schema.validate({ credit_limit: -1 }).error).toBeDefined();
  });
});
