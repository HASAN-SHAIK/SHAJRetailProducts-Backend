jest.mock('../db', () => ({ query: jest.fn() }));

const { deactivateBranch } = require('./branchService');

const makeRequest = (steps) => {
  const client = {
    query: jest.fn(async (sql) => {
      const step = steps.shift();
      if (!step) throw new Error(`unexpected SQL: ${sql}`);
      if (step.match && !sql.includes(step.match)) throw new Error(`expected ${step.match}, got ${sql}`);
      if (step.error) throw step.error;
      return step.result || { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  return { req: { tenantPool: { connect: jest.fn(async () => client) } }, client };
};

test('branch deactivation is transactional and blocked while active POS devices remain', async () => {
  const { req, client } = makeRequest([
    { match: 'BEGIN' },
    { match: 'FROM branches', result: { rows: [{ id: 'branch-a', is_active: true }], rowCount: 1 } },
    { match: 'FROM branch_devices', result: { rows: [{ count: 1 }], rowCount: 1 } },
    { match: 'ROLLBACK' },
  ]);

  await expect(deactivateBranch(req, 'branch-a')).rejects.toMatchObject({
    status: 409,
    code: 'BRANCH_HAS_ACTIVE_DEVICES',
  });
  expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE branches SET is_active = FALSE'))).toBe(false);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('branch deactivation soft-deactivates only after active devices are gone', async () => {
  const inactive = { id: 'branch-a', name: 'Store A', is_active: false };
  const { req, client } = makeRequest([
    { match: 'BEGIN' },
    { match: 'FROM branches', result: { rows: [{ id: 'branch-a', is_active: true }], rowCount: 1 } },
    { match: 'FROM branch_devices', result: { rows: [{ count: 0 }], rowCount: 1 } },
    { match: 'UPDATE branches SET is_active = FALSE', result: { rows: [inactive], rowCount: 1 } },
    { match: 'COMMIT' },
  ]);

  await expect(deactivateBranch(req, 'branch-a')).resolves.toEqual(inactive);
  expect(client.release).toHaveBeenCalledTimes(1);
});
