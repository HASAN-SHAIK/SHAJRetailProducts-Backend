const crypto = require('crypto');

const hashRefreshToken = (rawToken) =>
  crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');

const generateRefreshToken = (tenantId) => {
  const secret = crypto.randomBytes(48).toString('base64url');
  return `${tenantId}.${secret}`;
};

const getRefreshTtlMs = (rememberMe) => {
  if (rememberMe) {
    return Number(process.env.REFRESH_TOKEN_REMEMBER_MS || 30 * 24 * 60 * 60 * 1000);
  }
  return Number(process.env.REFRESH_TOKEN_TTL_MS || 8 * 60 * 60 * 1000);
};

const getAccessTtlMs = () => {
  const configured = process.env.ACCESS_TOKEN_MAX_AGE_MS;
  if (configured) return Number(configured);
  const expiry = process.env.ACCESS_TOKEN_EXPIRY || '15m';
  if (/^\d+$/.test(String(expiry))) return Number(expiry);
  if (String(expiry).endsWith('m')) return Number(String(expiry).replace('m', '')) * 60 * 1000;
  if (String(expiry).endsWith('h')) return Number(String(expiry).replace('h', '')) * 60 * 60 * 1000;
  return 15 * 60 * 1000;
};

const insertRefreshToken = async (
  queryable,
  { userId, tenantId, rememberMe = false, deviceId = null, branchId = null }
) => {
  const rawToken = generateRefreshToken(tenantId);
  const tokenHash = hashRefreshToken(rawToken);
  const ttlMs = getRefreshTtlMs(rememberMe);
  const expiresAt = new Date(Date.now() + ttlMs);

  await queryable.query(
    `INSERT INTO user_refresh_tokens
      (user_id, token_hash, remember_me, device_id, branch_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, tokenHash, rememberMe === true, deviceId, branchId, expiresAt]
  );

  return { rawToken, tokenHash, expiresAt, rememberMe: rememberMe === true, ttlMs };
};

const createRefreshToken = async (
  tenantPool,
  { userId, tenantId, rememberMe = false, deviceId = null, branchId = null }
) => insertRefreshToken(tenantPool, { userId, tenantId, rememberMe, deviceId, branchId });

const findValidRefreshToken = async (tenantPool, rawToken) => {
  if (!rawToken) return null;
  const tokenHash = hashRefreshToken(rawToken);
  const result = await tenantPool.query(
    `SELECT rt.*, u.id AS user_id, u.name, u.email, u.role, u.branch_id, u.all_branch_access, u.password
     FROM user_refresh_tokens rt
     INNER JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return result.rowCount > 0 ? { row: result.rows[0], tokenHash } : null;
};

const touchRefreshToken = async (tenantPool, tokenHash) => {
  await tenantPool.query(
    `UPDATE user_refresh_tokens
     SET last_used_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
};

const revokeRefreshToken = async (tenantPool, rawToken) => {
  if (!rawToken) return;
  const tokenHash = hashRefreshToken(rawToken);
  await tenantPool.query(
    `UPDATE user_refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
};

const revokeRefreshTokenByHash = async (tenantPool, tokenHash) => {
  if (!tokenHash) return;
  await tenantPool.query(
    `UPDATE user_refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
};

const rotateRefreshToken = async (
  tenantPool,
  { existingHash, userId, tenantId, rememberMe, deviceId, branchId }
) => {
  await revokeRefreshTokenByHash(tenantPool, existingHash);
  return createRefreshToken(tenantPool, { userId, tenantId, rememberMe, deviceId, branchId });
};

const consumeAndRotateRefreshToken = async (tenantPool, rawToken, tenantId) => {
  if (!tenantPool?.connect || !rawToken || !tenantId) return null;
  const tokenHash = hashRefreshToken(rawToken);
  const client = await tenantPool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const result = await client.query(
      `SELECT rt.*, u.id AS user_id, u.name, u.email, u.role, u.branch_id, u.all_branch_access, u.password,
              (rt.revoked_at IS NULL AND rt.expires_at > NOW()) AS is_valid
       FROM user_refresh_tokens rt
       INNER JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE OF rt`,
      [tokenHash]
    );

    if (!result.rowCount || result.rows[0].is_valid !== true) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return null;
    }

    const row = result.rows[0];
    await client.query(
      `UPDATE user_refresh_tokens
       SET revoked_at = NOW(), last_used_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    );

    const rotated = await insertRefreshToken(client, {
      userId: row.user_id,
      tenantId,
      rememberMe: row.remember_me === true,
      deviceId: row.device_id || null,
      branchId: row.branch_id || null,
    });

    await client.query('COMMIT');
    inTransaction = false;
    return { row, tokenHash, ...rotated };
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        // Preserve the original rotation failure.
      }
    }
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  hashRefreshToken,
  generateRefreshToken,
  getRefreshTtlMs,
  getAccessTtlMs,
  createRefreshToken,
  findValidRefreshToken,
  touchRefreshToken,
  revokeRefreshToken,
  revokeRefreshTokenByHash,
  rotateRefreshToken,
  consumeAndRotateRefreshToken,
};
