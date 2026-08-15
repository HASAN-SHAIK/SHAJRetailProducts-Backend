jest.mock('../controllers/branchController', () => ({
  getBranches: jest.fn((req, res) => res.status(200).json({ success: true, branches: [] })),
  createBranch: jest.fn((req, res) => res.status(201).json({ success: true }))
}));

jest.mock('../controllers/branchDeviceController', () => ({
  getBranchDevices: jest.fn(),
  deactivateBranchDevice: jest.fn(),
  updateBranchPlan: jest.fn(),
  registerDeviceOnBranch: jest.fn()
}));

const isAdmin = require('../middleware/isAdmin');
const router = require('./branchRoutes');

function getRoute(path, method) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === path && entry.route.methods?.[method]
  );
  if (!layer) throw new Error(`Missing ${method.toUpperCase()} ${path} route`);
  return layer.route;
}

describe('V1 Store/Device branch authority', () => {
  test('canonical branch creation is guarded by Central admin authority', () => {
    const route = getRoute('/', 'post');
    expect(route.stack).toHaveLength(2);
    expect(route.stack[0].handle).toBe(isAdmin);
  });

  test('non-admin tenant cannot pass the branch creation authority guard', () => {
    const req = { user: { type: 'tenant', role: 'staff' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    isAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access Denied. Admins only.' });
  });

  test('admin tenant can proceed to canonical branch creation', () => {
    const req = { user: { type: 'tenant', role: 'admin' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    isAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
