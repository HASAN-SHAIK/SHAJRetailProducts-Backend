const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const masterPool = require('../db/masterPool');
const adminPool = require('../db/adminPool');
const { getTenantPool, closeTenantPool } = require('../db/tenantPool');
const { provisionTenant } = require('./tenantProvisionService');
const { getTenantByDomain, getTenantById } = require('./tenantService');
const { registerTenantLoginEntry } = require('./tenantLoginDirectoryService');
const branchService = require('./branchService');
const { issueMobileAuthSession } = require('../controllers/authController');
const { resolveFeatures } = require('../utils/resolveFeatures');

const DEFAULT_TRIAL_DAYS = Math.max(1, Number(process.env.ONBOARDING_TRIAL_DAYS || 14));
const ALLOWED_PLANS = new Set(['basic', 'pro', 'premium']);
const GST_MODES = new Set(['INCLUSIVE', 'EXCLUSIVE']);

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const createHttpError = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const slugifyCompanyCode = (value) => {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || `shop-${crypto.randomBytes(3).toString('hex')}`;
};

const resolveUniqueCompanyCode = async ({ requestedCode, shopName }) => {
  if (requestedCode) {
    const normalized = slugifyCompanyCode(requestedCode);
    const existing = await getTenantByDomain(normalized);
    if (existing) {
      throw createHttpError(409, 'COMPANY_CODE_TAKEN', 'This company code is already in use');
    }
    return normalized;
  }

  const base = slugifyCompanyCode(shopName);
  const baseTaken = await getTenantByDomain(base);
  if (!baseTaken) return base;

  for (let i = 0; i < 6; i += 1) {
    const candidate = `${base.slice(0, 38)}-${crypto.randomBytes(2).toString('hex')}`;
    const taken = await getTenantByDomain(candidate);
    if (!taken) return candidate;
  }

  return `${base.slice(0, 34)}-${Date.now().toString(36)}`;
};

const getOnboardingPlans = async () => {
  const planRows = await masterPool.query(
    `SELECT name, price, duration_days, features
     FROM plans
     WHERE is_active = TRUE
     ORDER BY price ASC, id ASC`
  ).catch(() => ({ rowCount: 0, rows: [] }));

  if (planRows.rowCount > 0) {
    return planRows.rows.map((row) => ({
      code: String(row.name || 'basic').toLowerCase(),
      name: String(row.name || 'basic'),
      monthly_price: Number(row.price || 0),
      trial_days: DEFAULT_TRIAL_DAYS,
      features: row.features || {},
    }));
  }

  return ['basic', 'pro', 'premium'].map((code) => ({
    code,
    name: code,
    monthly_price: code === 'basic' ? 499 : code === 'pro' ? 799 : 1199,
    trial_days: DEFAULT_TRIAL_DAYS,
    features: resolveFeatures({ plan_type: code }),
  }));
};

const rollbackProvisionedTenant = async (provisioned) => {
  if (!provisioned) return;
  if (provisioned.database_name) {
    try {
      await closeTenantPool(provisioned.database_name);
    } catch (err) {
      console.error('Onboarding rollback failed to close tenant pool:', err.message || err);
    }
    try {
      await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(provisioned.database_name)}`);
    } catch (err) {
      console.error('Onboarding rollback failed to drop tenant DB:', err.message || err);
    }
  }
  if (provisioned.tenant_id) {
    try {
      await masterPool.query('DELETE FROM tenants WHERE id = $1', [provisioned.tenant_id]);
    } catch (err) {
      console.error('Onboarding rollback failed to remove master tenant:', err.message || err);
    }
  }
};

const onboardCompany = async (payload = {}, deviceContext = {}) => {
  const shopName = String(payload.shop_name || '').trim();
  const ownerName = String(payload.owner_name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const mobile = String(payload.mobile || '').trim();
  const password = String(payload.password || '');
  const requestedCode = String(payload.company_code || '').trim();
  const planTypeRaw = String(payload.plan_type || 'basic').trim().toLowerCase();
  const planType = ALLOWED_PLANS.has(planTypeRaw) ? planTypeRaw : 'basic';
  const gstModeRaw = String(payload.gst_mode || 'INCLUSIVE').trim().toUpperCase();
  if (!GST_MODES.has(gstModeRaw)) {
    throw createHttpError(400, 'VALIDATION_ERROR', 'gst_mode must be INCLUSIVE or EXCLUSIVE');
  }

  const storeName = String(payload.store_name || 'Main Store').trim() || 'Main Store';
  const storeNumber = String(payload.store_number || 'STORE-001').trim().toUpperCase() || 'STORE-001';
  const storeLocation = String(
    payload.store_location || payload.city || payload.address_line || ''
  ).trim() || null;

  const companyCode = await resolveUniqueCompanyCode({
    requestedCode: requestedCode || null,
    shopName,
  });

  const trialEndDate = new Date(Date.now() + DEFAULT_TRIAL_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let provisioned = null;
  try {
    provisioned = await provisionTenant({
      shop_name: shopName,
      domain: companyCode,
      plan_type: planType,
      owner_name: ownerName,
      email,
      mobile,
      gst_number: payload.gst_number ? String(payload.gst_number).trim().toUpperCase() : null,
      address_line: payload.address_line ? String(payload.address_line).trim() : null,
      city: payload.city ? String(payload.city).trim() : null,
      state: payload.state ? String(payload.state).trim() : null,
      pincode: payload.pincode ? String(payload.pincode).trim() : null,
      subscription_status: 'paid',
      subscription_end_date: trialEndDate,
      subscription_amount: 0,
      gst_mode: gstModeRaw,
    });

    const tenant = await getTenantById(provisioned.tenant_id);
    if (!tenant) {
      throw createHttpError(500, 'TENANT_LOAD_FAILED', 'Newly created company could not be loaded');
    }
    const tenantPool = getTenantPool(tenant.database_name);

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRes = await tenantPool.query(
      `INSERT INTO users (name, email, password, role, branch_id, all_branch_access)
       VALUES ($1, $2, $3, 'admin', NULL, TRUE)
       RETURNING id, name, email, role, branch_id, all_branch_access, created_at`,
      [ownerName, email, hashedPassword]
    );
    const ownerUser = userRes.rows[0];

    const firstBranch = await branchService.createBranch(
      { tenantPool, tenant },
      {
        store_number: storeNumber,
        name: storeName,
        location: storeLocation,
        subscription_plan: planType,
      }
    );

    await registerTenantLoginEntry({
      tenantId: tenant.id,
      email,
      mobile,
      companyCode,
    });

    const session = await issueMobileAuthSession({
      user: ownerUser,
      tenant,
      tenantPool,
      rememberMe: true,
      deviceId: deviceContext.deviceId || null,
      branchId: null,
    });

    return {
      ...session,
      company_code: companyCode,
      trial_days: DEFAULT_TRIAL_DAYS,
      trial_ends_at: trialEndDate,
      branch: firstBranch,
    };
  } catch (error) {
    await rollbackProvisionedTenant(provisioned);
    throw error;
  }
};

const safeQueryRows = async (pool, sql, params = []) => {
  try {
    const res = await pool.query(sql, params);
    return res.rows || [];
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return [];
    }
    throw error;
  }
};

const getOnboardingStatus = async ({ tenant, tenantPool }) => {
  const [branches, shopRows, deviceCounts, pendingRequests, userCounts] = await Promise.all([
    branchService.getBranches({ tenantPool }),
    safeQueryRows(
      tenantPool,
      `SELECT shop_name, owner_name, mobile_number, gst_number, address_line, city, state, pincode
       FROM shop_details
       ORDER BY id ASC
       LIMIT 1`
    ),
    safeQueryRows(
      tenantPool,
      `SELECT branch_id::text AS branch_id, COUNT(*)::int AS active_count
       FROM branch_devices
       WHERE is_active = TRUE
       GROUP BY branch_id`
    ),
    safeQueryRows(
      tenantPool,
      `SELECT COUNT(*)::int AS pending_count
       FROM pos_registration_requests
       WHERE status = 'PENDING'`
    ),
    safeQueryRows(
      tenantPool,
      `SELECT COUNT(*)::int AS total_users,
              COUNT(*) FILTER (WHERE LOWER(role) <> 'admin')::int AS staff_count
       FROM users`
    ),
  ]);

  const deviceCountByBranch = new Map(
    deviceCounts.map((row) => [String(row.branch_id), Number(row.active_count || 0)])
  );
  const totalActivePos = deviceCounts.reduce(
    (sum, row) => sum + Number(row.active_count || 0),
    0
  );
  const pendingRequestsCount = Number(pendingRequests[0]?.pending_count || 0);
  const totalUsers = Number(userCounts[0]?.total_users || 0);
  const staffCount = Number(userCounts[0]?.staff_count || 0);
  const shop = shopRows[0] || {};

  const activeBranches = branches.filter((b) => b.is_active !== false);
  const businessProfileCompleted = Boolean(
    (shop.shop_name || tenant?.shop_name) &&
      (shop.owner_name || tenant?.owner_name) &&
      (shop.mobile_number || tenant?.mobile) &&
      (shop.address_line || shop.city)
  );

  return {
    company: {
      id: tenant?.id || null,
      shop_name: shop.shop_name || tenant?.shop_name || '',
      company_code: tenant?.domain || null,
      plan_type: tenant?.plan_type || 'basic',
      gst_mode: tenant?.gst_mode || 'INCLUSIVE',
      gst_number: shop.gst_number || null,
    },
    stores: {
      count: activeBranches.length,
      total_count: branches.length,
      items: branches.map((b) => ({
        id: b.id,
        store_number: b.store_number || null,
        name: b.name,
        location: b.location || null,
        is_active: b.is_active !== false,
        active_devices: deviceCountByBranch.get(String(b.id)) || 0,
      })),
    },
    pos_devices: {
      active_count: totalActivePos,
      pending_requests_count: pendingRequestsCount,
    },
    staff: {
      total_users: totalUsers,
      staff_count: staffCount,
    },
    checklist: {
      company_created: Boolean(tenant?.id),
      business_profile_completed: businessProfileCompleted,
      store_created: activeBranches.length > 0,
      staff_added: staffCount > 0,
      pos_onboarded: totalActivePos > 0,
    },
  };
};

module.exports = {
  slugifyCompanyCode,
  getOnboardingPlans,
  onboardCompany,
  getOnboardingStatus,
};
