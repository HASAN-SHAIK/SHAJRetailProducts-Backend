jest.mock('../db', () => ({ query: jest.fn() }));

const { deactivateBranch, getBranches, createBranch } = require('./branchService');

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
  await expect(deactivateBranch(req, 'branch-a')).rejects.toMatchObject({ status: 409, code: 'BRANCH_HAS_ACTIVE_DEVICES' });
  expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE branches SET is_active = FALSE'))).toBe(false);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('branch deactivation soft-deactivates only after active devices are gone', async () => {
  const inactive = { id: 'branch-a', store_number: 'STORE-001', name: 'Store A', is_active: false };
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

test('branch list ensures lifecycle and Store Number schema before reading', async () => {
  const tenantPool = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'branch-a', store_number: 'STORE-001', name: 'Mattampally', is_active: true }], rowCount: 1 }),
  };
  await expect(getBranches({ tenantPool })).resolves.toEqual([
    { id: 'branch-a', store_number: 'STORE-001', name: 'Mattampally', is_active: true },
  ]);
  expect(tenantPool.query.mock.calls[0][0]).toContain('ADD COLUMN IF NOT EXISTS is_active');
  expect(tenantPool.query.mock.calls[1][0]).toContain('ADD COLUMN IF NOT EXISTS store_number');
  expect(tenantPool.query.mock.calls[2][0]).toContain('uq_branches_store_number');
  expect(tenantPool.query.mock.calls[3][0]).toContain('SELECT id, store_number');
});

test('store creation requires Store Number', async () => {
  const tenantPool = { query: jest.fn() };
  await expect(createBranch({ tenantPool }, { name: 'Store A' })).rejects.toThrow('store_number is required');
  expect(tenantPool.query).not.toHaveBeenCalled();
});

test('store creation normalizes Store Number and persists it with the branch', async () => {
  const tenantPool = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'branch-a', store_number: 'STORE-001', name: 'Store A', is_active: true }], rowCount: 1 }),
  };
  const created = await createBranch({ tenantPool, tenant: { plan_type: 'basic' } }, { store_number: ' store-001 ', name: 'Store A' });
  expect(created.store_number).toBe('STORE-001');
  expect(tenantPool.query.mock.calls[3][0]).toContain('INSERT INTO branches (store_number');
  expect(tenantPool.query.mock.calls[3][1][0]).toBe('STORE-001');
});
