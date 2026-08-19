const fs = require('fs');
const path = require('path');

jest.mock('../src/db/masterPool', () => ({
  query: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
}));

const masterPool = require('../src/db/masterPool');
const bcrypt = require('bcryptjs');
const { bootstrapMasterDatabase } = require('../src/services/masterBootstrap');

const EXPECTED_TABLES = [
  'shop_types',
  'tenants',
  'tenant_config',
  'subscriptions',
  'platform_admins',
  'plans',
  'subscription_payments',
  'platform_activity_logs',
  'platform_settings',
  'support_cases',
  'support_case_messages',
  'support_case_attachments',
];

const installQueryBehavior = ({ hasAdmin }) => {
  masterPool.query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text === 'SELECT 1') return { rowCount: 1, rows: [{ '?column?': 1 }] };
    if (text.includes('information_schema.tables')) {
      return { rowCount: EXPECTED_TABLES.length, rows: EXPECTED_TABLES.map((table_name) => ({ table_name })) };
    }
    if (text === 'SELECT id FROM platform_admins LIMIT 1') {
      return hasAdmin ? { rowCount: 1, rows: [{ id: 7 }] } : { rowCount: 0, rows: [] };
    }
    if (text.includes('INSERT INTO platform_admins')) return { rowCount: 1, rows: [] };
    if (text.includes('INSERT INTO plans')) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected bootstrap query: ${text}`);
  });
};

describe('V1 master bootstrap platform-admin security', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ADMIN_SEED_EMAIL;
    delete process.env.ADMIN_SEED_PASSWORD;
    delete process.env.ADMIN_SEED_NAME;
    delete process.env.ADMIN_SEED_ROLE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('does not require seed credentials when an administrator already exists', async () => {
    installQueryBehavior({ hasAdmin: true });

    await expect(bootstrapMasterDatabase()).resolves.toBeUndefined();
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(masterPool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_admins'),
      expect.anything()
    );
  });

  test('fails closed instead of creating a hard-coded administrator on an empty platform database', async () => {
    installQueryBehavior({ hasAdmin: false });

    await expect(bootstrapMasterDatabase()).rejects.toThrow(
      'ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required'
    );
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(masterPool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_admins'),
      expect.anything()
    );
  });

  test('creates the first administrator only from the hardened explicit seed policy', async () => {
    installQueryBehavior({ hasAdmin: false });
    process.env.ADMIN_SEED_EMAIL = 'bootstrap@example.com';
    process.env.ADMIN_SEED_PASSWORD = 'correct-horse-battery-staple';
    process.env.ADMIN_SEED_NAME = 'Bootstrap Admin';
    process.env.ADMIN_SEED_ROLE = 'super_admin';
    bcrypt.hash.mockResolvedValue('hashed-bootstrap-password');

    await bootstrapMasterDatabase();

    expect(bcrypt.hash).toHaveBeenCalledWith('correct-horse-battery-staple', 10);
    expect(masterPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_admins'),
      ['Bootstrap Admin', 'bootstrap@example.com', 'hashed-bootstrap-password', 'super_admin']
    );
  });

  test('production startup propagates master bootstrap failures instead of skipping them', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.js'), 'utf8');
    expect(appSource).toContain("if (APP_ENVIRONMENT === 'production')");
    expect(appSource).toMatch(/if \(APP_ENVIRONMENT === 'production'\) \{\s*throw error;\s*\}/);
  });

  test('master bootstrap contains no legacy hard-coded administrator credentials', () => {
    const bootstrapSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'masterBootstrap.js'),
      'utf8'
    );
    expect(bootstrapSource).not.toContain('hasan@shaj.com');
    expect(bootstrapSource).not.toContain('hasan@6255');
    expect(bootstrapSource).toContain('resolvePlatformAdminSeedConfig');
  });
});
