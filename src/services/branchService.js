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

const normalizeStoreNumber = (value) => String(value || '').trim().toUpperCase();
const isMissingActiveColumnError = (error) =>
  error?.code === '42703' && String(error?.message || '').toLowerCase().includes('is_active');

const ensureBranchLifecycleColumns = async (requestPool) => {
  await requestPool.query(
    `ALTER TABLE IF EXISTS branches
     ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`
  );
  await requestPool.query(`ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS store_number TEXT`);
  await requestPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_store_number ON branches (UPPER(store_number)) WHERE store_number IS NOT NULL AND BTRIM(store_number) <> ''`);
};

const getBranches = async (req) => {
  const requestPool = getRequestPool(req);
  try {
    await ensureBranchLifecycleColumns(requestPool);
    const result = await requestPool.query(
      `SELECT id, store_number, name, location, created_at, subscription_plan, max_devices_allowed, is_active
       FROM branches
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (error) {
    if (error?.message && error.message.toLowerCase().includes('relation "branches" does not exist')) return [];
    throw error;
  }
};

const createBranch = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const name = String(payload.name || '').trim();
  const storeNumber = normalizeStoreNumber(payload.store_number || payload.storeNumber);
  const location = payload.location ? String(payload.location || '').trim() : null;
  const planFromTenant = normalizePlan(req?.tenant?.plan_type || req?.subscription?.plan_name || 'basic');
  const planLimit = resolvePlanDeviceLimit(planFromTenant);
  const subscriptionPlan = normalizePlan(payload.subscription_plan || planFromTenant || 'basic');
  const maxDevicesAllowedRaw = payload.max_devices_allowed;
  const maxDevicesAllowed = Number.isFinite(Number(maxDevicesAllowedRaw)) ? Number(maxDevicesAllowedRaw) : (planLimit === null ? null : planLimit);

  if (!name) throw buildValidationError('name is required.');
  if (!storeNumber) throw buildValidationError('store_number is required.');

  try {
    await ensureBranchLifecycleColumns(requestPool);
    const result = await requestPool.query(
      `INSERT INTO branches (store_number, name, location, subscription_plan, max_devices_allowed, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, store_number, name, location, created_at, subscription_plan, max_devices_allowed, is_active`,
      [storeNumber, name, location || null, subscriptionPlan, maxDevicesAllowed]
    );
    return result.rows[0];
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (error?.code === '23505') throw buildStatusError(409, 'STORE_NUMBER_IN_USE', 'Store number already exists');
    const branchesMissing = msg.includes('relation "branches" does not exist') || msg.includes('relation branches does not exist');
    const uuidMissing = msg.includes('gen_random_uuid') && (msg.includes('does not exist') || msg.includes('undefined function'));
    if (!branchesMissing && !uuidMissing) throw error;

    await requestPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await requestPool.query(
      `CREATE TABLE IF NOT EXISTS branches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_number TEXT,
        name TEXT NOT NULL,
        location TEXT,
        subscription_plan TEXT DEFAULT 'basic',
        max_devices_allowed INTEGER DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );
    await ensureBranchLifecycleColumns(requestPool);
    const result = await requestPool.query(
      `INSERT INTO branches (store_number, name, location, subscription_plan, max_devices_allowed, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, store_number, name, location, created_at, subscription_plan, max_devices_allowed, is_active`,
      [storeNumber, name, location || null, subscriptionPlan, maxDevicesAllowed]
    );
    return result.rows[0];
  }
};

const updateBranch = async (req, branchId, payload = {}) => {
  const requestPool = getRequestPool(req);
  const name = payload.name === undefined ? undefined : String(payload.name || '').trim();
  const hasStoreNumber = payload.store_number !== undefined || payload.storeNumber !== undefined;
  const storeNumber = hasStoreNumber ? normalizeStoreNumber(payload.store_number ?? payload.storeNumber) : undefined;
  const location = payload.location === undefined ? undefined : (payload.location === null ? null : String(payload.location).trim());
  if (name === '') throw buildValidationError('name cannot be blank.');
  if (hasStoreNumber && !storeNumber) throw buildValidationError('store_number cannot be blank.');
  if (name === undefined && location === undefined && storeNumber === undefined) throw buildValidationError('store_number, name or location is required.');

  await ensureBranchLifecycleColumns(requestPool);
  try {
    const result = await requestPool.query(
      `UPDATE branches
       SET store_number = CASE WHEN $2::boolean THEN $3 ELSE store_number END,
           name = COALESCE($4, name),
           location = CASE WHEN $5::boolean THEN $6 ELSE location END
       WHERE id::text = $1
       RETURNING id, store_number, name, location, created_at, subscription_plan, max_devices_allowed, is_active`,
      [String(branchId), hasStoreNumber, storeNumber || null, name || null, location !== undefined, location === undefined ? null : location]
    );
    if (!result.rowCount) throw buildStatusError(404, 'BRANCH_NOT_FOUND', 'Branch not found');
    return result.rows[0];
  } catch (error) {
    if (error?.code === '23505') throw buildStatusError(409, 'STORE_NUMBER_IN_USE', 'Store number already exists');
    throw error;
  }
};

const deactivateBranch = async (req, branchId) => {
  const requestPool = getRequestPool(req);
  const client = typeof requestPool.connect === 'function' ? await requestPool.connect() : requestPool;
  try {
    await client.query('BEGIN');
    const branch = await client.query(`SELECT id, is_active FROM branches WHERE id::text = $1 FOR UPDATE`, [String(branchId)]);
    if (!branch.rowCount) throw buildStatusError(404, 'BRANCH_NOT_FOUND', 'Branch not found');
    if (branch.rows[0].is_active !== true) {
      await client.query('COMMIT');
      return { id: String(branch.rows[0].id), is_active: false, already_inactive: true };
    }
    const activeDevices = await client.query(`SELECT COUNT(*)::int AS count FROM branch_devices WHERE branch_id::text = $1 AND is_active = TRUE`, [String(branchId)]);
    if (Number(activeDevices.rows[0]?.count || 0) > 0) throw buildStatusError(409, 'BRANCH_HAS_ACTIVE_DEVICES', 'Deactivate all POS devices on the branch before deactivating the branch');
    const updated = await client.query(
      `UPDATE branches SET is_active = FALSE WHERE id::text = $1
       RETURNING id, store_number, name, location, created_at, subscription_plan, max_devices_allowed, is_active`,
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
