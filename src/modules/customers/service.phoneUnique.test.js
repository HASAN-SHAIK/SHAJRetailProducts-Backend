const { createCustomer, updateCustomer } = require('./service');

const result = (rows = []) => ({ rows, rowCount: rows.length });
const pgError = (code, constraint) => Object.assign(new Error('unique violation'), { code, constraint });

const makePool = ({ failOn, error }) => {
  const query = jest.fn(async (sql) => {
    if (failOn.test(sql)) throw error;
    if (/SELECT \* FROM customers WHERE id/.test(sql)) {
      return result([{ id: 5, name: 'A', phone: '9999999999', credit_limit: 0, type: 'retail', is_active: false }]);
    }
    return result([]);
  });
  const client = { query, release: jest.fn() };
  return { query, connect: jest.fn(async () => client) };
};

describe('phone unique index violation mapping', () => {
  test.each([
    ['named index', 'idx_customers_active_phone_digits_unique'],
    ['no constraint name', undefined],
  ])('createCustomer maps 23505 (%s) to 409 DUPLICATE_CUSTOMER', async (_label, constraint) => {
    const pool = makePool({ failOn: /INSERT INTO customers/, error: pgError('23505', constraint) });
    await expect(createCustomer(pool, { name: 'X', phone: '98765 43210' })).rejects.toMatchObject({
      status: 409,
      statusCode: 409,
      code: 'DUPLICATE_CUSTOMER',
    });
  });

  test('updateCustomer maps 23505 on phone change and on reactivation without phone', async () => {
    const withPhone = makePool({ failOn: /UPDATE customers/, error: pgError('23505') });
    await expect(updateCustomer(withPhone, 5, { phone: '8888888888' })).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_CUSTOMER',
    });
    const reactivate = makePool({ failOn: /UPDATE customers/, error: pgError('23505') });
    await expect(updateCustomer(reactivate, 5, { is_active: true })).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_CUSTOMER',
    });
  });

  test('other unique violations and other errors pass through unchanged', async () => {
    const other = makePool({ failOn: /INSERT INTO customers/, error: pgError('23505', 'customers_email_key') });
    await expect(createCustomer(other, { name: 'X', phone: '9876543210' })).rejects.toMatchObject({ code: '23505' });
    const boom = makePool({ failOn: /INSERT INTO customers/, error: pgError('XX000') });
    await expect(createCustomer(boom, { name: 'X', phone: '9876543210' })).rejects.toMatchObject({ code: 'XX000' });
  });
});
