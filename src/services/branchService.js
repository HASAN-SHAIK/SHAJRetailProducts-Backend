const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const { resolvePlanDeviceLimit, normalizePlan } = require('../config/planDeviceLimits');

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const buildStatusError = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const getBranches = async (req) => {
  const requestPool = getRequestPool(req);
  try {
    const result = await requestPool.query(
      `SELECT id, name, location, created_at, subscription_plan, max_devices_allowed, is_active
       FROM branches
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (error) {
    if (error?.message && error.message.toLowerCase().includes('relation "branches" does not exist')) {
      return [];
    }
    throw error;
  }
};

const createBranch = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const name = String(payload.name || '').trim();
  const location = payload.location ? String(payload.location || '').trim() : null;
  const planFromTenant = normalizePlan(req?.tenant?.plan_type || req?.subscription?.plan_name || 'basic');
  const planLimit = resolvePlanDeviceLimit(planFromTenant);
  const subscriptionPlan = normalizePlan(payload.subscription_plan || planFromTenant || 'basic');
  const maxDevicesAllowedRaw = payload.max_devices_allowed;
  const maxDevicesAllowed = Number.isFinite(Number(maxDevicesAllowedRaw))
    ? Number(maxDevicesAllowedRaw)
    : (planLimit === null ? null : planLimit);

  if (!name) throw buildValidationError('name is required.');

  try {
    const result = await requestPool.query(
      `INSERT INTO branches (name, location, subscription_plan, max_devices_allowed, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, name, location, created_at, subscription_plan, max_devices_allowed, is_active`,
      [name, location || null, subscriptionPlan, maxDevicesAllowed]
    );
    return result.rows[0];
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    const branchesMissing = msg.includes('relation "branches" does not exist') || msg.includes('relation branches does not exist');
    const uuidMissing = msg.includes('gen_random_uuid') && (msg.includes('does not exist') || msg.includes('undefined function'));
    if (!branchesMissing && !uuidMissing) throw error;

    await requestPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await requestPool.query(
      `CREATE TABLE IF NOT EXISTS branches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        location TEXT,
        subscription_plan TEXT DEFAULT 'basic',
        max_devices_allowed INTEGER DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );

    const result = await requestPool.query(
      `INSERT INTO branches (name, location, subscription_plan, max_devices_allowed, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, name, location, created_at, subscription_plan, max_devices_allowed, is_active`,
      [name, location || null, subscriptionPlan, maxDevicesAllowed]
    );
    return result.rows[0];
  }
};

const updateBranch = async (req, branchId, payload = {}) => {
  const requestPool = getRequestPool(req);
  const name = payload.name === undefined ? undefined : String(payload.name || '').trim();
  const location = payload.location === undefined ? undefined : (payload.location === null ? null : String(payload.location).trim());
  if (name === '') throw buildValidationError('name cannot be blank.');
  if (name === undefined && location === undefined) throw buildValidationError('name or location is required.');

  const result = await requestPool.query(
    `UPDATE branches
     SET name = COALESCE($2, name),
         location = CASE WHEN $3::boolean THEN $4 ELSE location END
     WHERE id::text = $1
     RETURNING id, name, location, created_at, subscription_plan, max_devices_allowed, is_active`,
    [String(branchId), name || null, location !== undefined, location === undefined ? null : location]
  );
  if (!result.rowCount) throw buildStatusError(404, 'BRANCH_NOT_FOUND', 'Branch not found');
  return result.rows[0];
};

const deactivateBranch = async (req, branchId) => {
  const requestPool = getRequestPool(req);
  const client = typeof requestPool.connect === 'function' ? await requestPool.connect() : requestPool;
  try {
    await client.query('BEGIN');
    const branch = await client.query(
      `SELECT id, is_active FROM branches WHERE id::text = $1 FOR UPDATE`,
      [String(branchId)]
    );
    if (!branch.rowCount) throw buildStatusError(404, 'BRANCH_NOT_FOUND', 'Branch not found');

    if (branch.rows[0].is_active !== true) {
      await client.query('COMMIT');
      return { id: String(branch.rows[0].id), is_active: false, already_inactive: true };
    }

    const activeDevices = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM branch_devices
       WHERE branch_id::text = $1 AND is_active = TRUE`,
      [String(branchId)]
    );
    if (Number(activeDevices.rows[0]?.count || 0) > 0) {
      throw buildStatusError(
        409,
        'BRANCH_HAS_ACTIVE_DEVICES',
        'Deactivate all POS devices on the branch before deactivating the branch'
      );
    }

    const updated = await client.query(
      `UPDATE branches SET is_active = FALSE WHERE id::text = $1
       RETURNING id, name, location, created_at, subscription_plan, max_devices_allowed, is_active`,
      [String(branchId)]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    if (client !== requestPool && typeof client.release === 'function') client.release();
  }
};

module.exports = { getBranches, createBranch, updateBranch, deactivateBranch };
