const crypto = require('crypto');
const { Pool } = require('pg');
const {
  createRefreshToken,
  consumeAndRotateRefreshToken,
  hashRefreshToken,
} = require('../src/services/authSessionService');

const databaseUrl = process.env.V1_AUTH_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('V1 refresh-token PostgreSQL acceptance', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`
      DROP TABLE IF EXISTS user_refresh_tokens;
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id BIGINT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        branch_id TEXT,
        all_branch_access BOOLEAN NOT NULL DEFAULT FALSE,
        password TEXT NOT NULL
      );
      CREATE TABLE user_refresh_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        token_hash TEXT NOT NULL UNIQUE,
        remember_me BOOLEAN NOT NULL DEFAULT FALSE,
        device_id TEXT,
        branch_id TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      );
    `);
    await pool.query(
      `INSERT INTO users(id, name, email, role, branch_id, all_branch_access, password)
       VALUES (44, 'Cashier', 'cashier@example.com', 'cashier', 'branch-1', FALSE, 'hash')`
    );
  });

  afterEach(async () => {
    await pool.query('DELETE FROM user_refresh_tokens');
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('concurrent use consumes one predecessor and creates exactly one valid successor', async () => {
    const predecessor = await createRefreshToken(pool, {
      userId: 44,
      tenantId: 'tenant-1',
      rememberMe: true,
      deviceId: 'device-1',
      branchId: 'branch-1',
    });

    const [first, second] = await Promise.all([
      consumeAndRotateRefreshToken(pool, predecessor.rawToken, 'tenant-1'),
      consumeAndRotateRefreshToken(pool, predecessor.rawToken, 'tenant-1'),
    ]);

    const successful = [first, second].filter(Boolean);
    expect(successful).toHaveLength(1);
    expect(successful[0].row).toMatchObject({
      user_id: '44',
      role: 'cashier',
      branch_id: 'branch-1',
      remember_me: true,
      device_id: 'device-1',
    });
    expect(successful[0].rawToken).not.toBe(predecessor.rawToken);

    const predecessorState = await pool.query(
      'SELECT revoked_at, last_used_at FROM user_refresh_tokens WHERE token_hash = $1',
      [hashRefreshToken(predecessor.rawToken)]
    );
    expect(predecessorState.rows[0].revoked_at).toBeTruthy();
    expect(predecessorState.rows[0].last_used_at).toBeTruthy();

    const active = await pool.query(
      'SELECT token_hash FROM user_refresh_tokens WHERE revoked_at IS NULL AND expires_at > NOW()'
    );
    expect(active.rowCount).toBe(1);
    expect(active.rows[0].token_hash).toBe(hashRefreshToken(successful[0].rawToken));

    const replay = await consumeAndRotateRefreshToken(pool, predecessor.rawToken, 'tenant-1');
    expect(replay).toBeNull();
  });

  test('expired predecessor is rejected without creating a successor', async () => {
    const rawToken = `tenant-1.${crypto.randomBytes(24).toString('base64url')}`;
    await pool.query(
      `INSERT INTO user_refresh_tokens
        (user_id, token_hash, remember_me, device_id, branch_id, expires_at)
       VALUES (44, $1, FALSE, 'device-1', 'branch-1', NOW() - INTERVAL '1 minute')`,
      [hashRefreshToken(rawToken)]
    );

    const rotated = await consumeAndRotateRefreshToken(pool, rawToken, 'tenant-1');
    expect(rotated).toBeNull();

    const rows = await pool.query('SELECT revoked_at FROM user_refresh_tokens');
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].revoked_at).toBeNull();
  });
});
