const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const { resolvePlanDeviceLimit, normalizePlan } = require('../config/planDeviceLimits');

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const getBranches = async (req) => {
  const requestPool = getRequestPool(req);
  try {
    const result = await requestPool.query(
      `SELECT id, name, location, created_at, subscription_plan, max_devices_allowed
       FROM branches
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (error) {
    // If migrations/schema weren't applied yet, don't crash the app.
    // Returning [] preserves current flow for first-time installs.
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

  if (!name) {
    throw buildValidationError('name is required.');
  }

  try {
    const result = await requestPool.query(
      `INSERT INTO branches (name, location, subscription_plan, max_devices_allowed)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, location, created_at, subscription_plan, max_devices_allowed`,
      [name, location || null, subscriptionPlan, maxDevicesAllowed]
    );
    return result.rows[0];
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    const branchesMissing = msg.includes('relation "branches" does not exist') || msg.includes('relation branches does not exist');
    const uuidMissing = msg.includes('gen_random_uuid') && (msg.includes('does not exist') || msg.includes('undefined function'));
    if (!branchesMissing && !uuidMissing) throw error;

    // Best-effort bootstrap: ensure extension + table exist.
    await requestPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await requestPool.query(
      `CREATE TABLE IF NOT EXISTS branches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        location TEXT,
        subscription_plan TEXT DEFAULT 'basic',
        max_devices_allowed INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );

    const result = await requestPool.query(
      `INSERT INTO branches (name, location, subscription_plan, max_devices_allowed)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, location, created_at, subscription_plan, max_devices_allowed`,
      [name, location || null, subscriptionPlan, maxDevicesAllowed]
    );
    return result.rows[0];
  }
};

module.exports = { getBranches, createBranch };
