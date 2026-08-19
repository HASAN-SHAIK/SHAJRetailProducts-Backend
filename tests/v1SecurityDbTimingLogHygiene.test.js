const { attachQueryTimer } = require('../src/db/poolUtils');

const makePool = () => ({
  query: jest.fn(async () => ({ rows: [] })),
  connect: jest.fn(async () => ({ release() {} })),
});

describe('V1 database timing log hygiene', () => {
  const originalEnv = process.env;
  let logSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    logSpy.mockRestore();
  });

  test('production timing logs preserve duration observability without logging SQL text', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_LOG_TIMING = 'true';
    process.env.DB_LOG_TIMING_THRESHOLD_MS = '0';

    const pool = makePool();
    attachQueryTimer(pool, 'tenant:test');

    await pool.query("SELECT 'customer-secret@example.com' AS sensitive_value");

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('[DB] tenant:test query took');
    expect(output).not.toContain('SELECT');
    expect(output).not.toContain('customer-secret@example.com');
  });

  test('non-production timing logs retain query text for local diagnostics', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DB_LOG_TIMING = 'true';
    process.env.DB_LOG_TIMING_THRESHOLD_MS = '0';

    const pool = makePool();
    attachQueryTimer(pool, 'tenant:test');

    await pool.query('SELECT 1');

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('[DB] tenant:test query took');
    expect(output).toContain('SELECT 1');
  });
});
