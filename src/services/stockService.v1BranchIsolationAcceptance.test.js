jest.mock('../db', () => ({ query: jest.fn() }));

const { getBranchStock } = require('./stockService');

const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';

const makePool = () => ({
  query: jest.fn().mockResolvedValue({ rows: [] })
});

describe('V1 inventory branch isolation acceptance', () => {
  test('restricted staff stock reads are pinned to the assigned branch', async () => {
    const tenantPool = makePool();
    const req = {
      tenantPool,
      headers: { 'x-branch-id': BRANCH_B },
      query: {},
      body: {},
      user: {
        role: 'staff',
        all_branch_access: false,
        branch_id: BRANCH_A
      }
    };

    await getBranchStock(req, 101);

    expect(tenantPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = tenantPool.query.mock.calls[0];
    expect(sql).toContain('WHERE ($2::uuid IS NULL OR b.id = $2::uuid)');
    expect(params).toEqual([101, BRANCH_A]);
  });

  test('privileged reads may explicitly scope to a requested branch', async () => {
    const tenantPool = makePool();
    const req = {
      tenantPool,
      headers: { 'x-branch-id': BRANCH_B },
      query: {},
      body: {},
      user: { role: 'admin', all_branch_access: true }
    };

    await getBranchStock(req, 101);

    expect(tenantPool.query.mock.calls[0][1]).toEqual([101, BRANCH_B]);
  });

  test('privileged all-branch read remains available when no branch is requested', async () => {
    const tenantPool = makePool();
    const req = {
      tenantPool,
      headers: {},
      query: {},
      body: {},
      user: { role: 'admin', all_branch_access: true }
    };

    await getBranchStock(req, 101);

    expect(tenantPool.query.mock.calls[0][1]).toEqual([101, null]);
  });
});
