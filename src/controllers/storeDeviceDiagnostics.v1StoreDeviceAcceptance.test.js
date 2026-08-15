const mockFetchBranchPolicy = jest.fn();
const mockResolveBranchDeviceLimit = jest.fn();

jest.mock('../utils/branchDeviceLicensing', () => ({
  fetchBranchPolicy: (...args) => mockFetchBranchPolicy(...args),
  resolveBranchDeviceLimit: (...args) => mockResolveBranchDeviceLimit(...args),
  ensureDeviceRegistration: jest.fn(),
  sanitizeDeviceContext: jest.fn(),
}));

const { getBranchDevices } = require('./branchDeviceController');
const { listRegistrationRequests } = require('./posRegistrationController');

const response = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('admin device diagnostics expose licensing, last-seen, and revoked/inactive state', async () => {
  const branch = { id: 'branch-a', subscription_plan: 'PRO', max_devices_allowed: 3 };
  const devices = [
    {
      id: 11,
      device_id: 'pos-active',
      device_name: 'Front Register',
      browser_info: 'POSService',
      os_info: 'linux',
      ip_address: '10.0.0.10',
      last_login_at: new Date('2026-08-15T21:00:00Z'),
      is_active: true,
      created_at: new Date('2026-08-01T00:00:00Z'),
    },
    {
      id: 12,
      device_id: 'pos-revoked',
      device_name: 'Old Register',
      browser_info: 'POSService',
      os_info: 'linux',
      ip_address: '10.0.0.11',
      last_login_at: new Date('2026-08-14T20:00:00Z'),
      is_active: false,
      created_at: new Date('2026-07-01T00:00:00Z'),
    },
  ];
  mockFetchBranchPolicy.mockResolvedValue(branch);
  mockResolveBranchDeviceLimit.mockReturnValue(3);

  const tenantPool = {
    query: jest.fn(async (sql) => {
      if (sql.includes('SELECT id, device_id, device_name')) return { rows: devices, rowCount: devices.length };
      if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  const res = response();

  await getBranchDevices({ params: { branchId: 'branch-a' }, tenantPool }, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    success: true,
    data: expect.objectContaining({
      branch: expect.objectContaining({ id: 'branch-a', subscription_plan: 'PRO', resolved_limit: 3 }),
      active_count: 1,
      devices: expect.arrayContaining([
        expect.objectContaining({ device_id: 'pos-active', is_active: true, last_login_at: devices[0].last_login_at }),
        expect.objectContaining({ device_id: 'pos-revoked', is_active: false, last_login_at: devices[1].last_login_at }),
      ]),
    }),
  }));
});

test('admin registration diagnostics expose lifecycle, branch, terminal, reviewer, and claim timestamps', async () => {
  const registration = {
    request_id: 'posreg-1',
    device_id: 'replacement-pos',
    installation_id: 'install-1',
    device_name: 'Replacement Register',
    os_info: 'linux',
    status: 'CLAIMED',
    branch_id: 'branch-a',
    terminal_id: 'T-01',
    requested_at: new Date('2026-08-15T20:00:00Z'),
    reviewed_at: new Date('2026-08-15T20:05:00Z'),
    reviewed_by: 'admin-1',
    claimed_at: new Date('2026-08-15T20:06:00Z'),
  };
  const tenantPool = {
    query: jest.fn(async (sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS pos_registration_requests')) return { rows: [], rowCount: 0 };
      if (sql.includes('CREATE INDEX IF NOT EXISTS')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT request_id, device_id, installation_id')) return { rows: [registration], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  const res = response();

  await listRegistrationRequests({ query: {}, tenantPool }, res, (error) => { throw error; });

  expect(res.json).toHaveBeenCalledWith({ requests: [registration] });
  expect(tenantPool.query).toHaveBeenCalledWith(
    expect.stringContaining('reviewed_by, claimed_at'),
    []
  );
});