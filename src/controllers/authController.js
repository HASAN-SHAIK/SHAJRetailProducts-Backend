const bcrypt = require('bcryptjs');
const { getTenantById, getTenantByDomain } = require('../services/tenantService');
const { getTenantPool } = require('../db/tenantPool');
const { jsonError, jsonOk } = require('../utils/responses');
const {
  DEFAULT_TENANT_COOKIE,
  DEFAULT_TENANT_REFRESH_COOKIE,
  signTenantToken,
  setAuthCookie,
  clearAuthCookie
} = require('../utils/jwt');
const { getPermissionsForRole, getStorePermissions } = require('../utils/rolePermissions');
const {
  createRefreshToken,
  consumeAndRotateRefreshToken,
  revokeRefreshToken,
  getAccessTtlMs,
  getRefreshTtlMs
} = require('../services/authSessionService');
const { ensureDeviceRegistration, sanitizeDeviceContext } = require('../utils/branchDeviceLicensing');
const { resolveTenantsForLogin } = require('../services/tenantLoginDirectoryService');
const { loadLatestSubscriptionInfo } = require('../services/subscriptionStatusService');
require('dotenv').config();

const parseRefreshTenantId = (rawToken) => {
  const text = String(rawToken || '');
  const separatorIndex = text.indexOf('.');
  if (separatorIndex <= 0) return null;
  return text.slice(0, separatorIndex);
};

const resolveTenantFromRequest = async ({ email, companyCode = null, tenantId = null }) => {
  const resolution = await resolveTenantsForLogin({ email, companyCode, tenantId });
  if (resolution?.ambiguous) {
    return { tenant: null, ambiguous: true, candidates: resolution.candidates || [] };
  }
  if (resolution?.tenant) {
    return { tenant: resolution.tenant, ambiguous: false, candidates: [resolution.tenant] };
  }
  if (email && email.includes('@') && !companyCode && !tenantId) {
    const domain = email.split('@')[1].trim().toLowerCase();
    const cleanDomain = domain.replace(/\.com$/, '');
    if (cleanDomain) {
      const tenant = await getTenantByDomain(cleanDomain);
      return { tenant, ambiguous: false, candidates: tenant ? [tenant] : [] };
    }
  }
  return { tenant: null, ambiguous: false, candidates: [] };
};

const buildTenantTokenPayload = (user, tenant) => ({
  type: 'tenant',
  user_id: user.id,
  tenant_id: tenant.id,
  role: user.role,
  user_name: user.name,
  tenant_db: tenant.database_name,
  tenant_name: tenant.shop_name,
  tenant_owner: tenant.owner_name,
  tenant_email: tenant.email,
  tenant_mobile: tenant.mobile,
  tenant_plan: tenant.plan_type,
  tenant_active: tenant.is_active,
  tenant_addons: tenant.addons || {},
  tenant_gst_mode: tenant.gst_mode || 'INCLUSIVE',
  branch_id: user.branch_id || null,
  all_branch_access: user.all_branch_access !== false,
  permissions: getPermissionsForRole(user.role),
  store_permissions: getStorePermissions(user),
});

const buildSessionUser = (user, tenant) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  tenant_id: tenant?.id || user.tenant_id || null,
  branch_id: user.branch_id || null,
  all_branch_access: user.all_branch_access !== false,
  permissions: getPermissionsForRole(user.role),
  store_permissions: getStorePermissions(user),
});

const buildVerifiedSessionUser = (verified) => ({
  ...verified,
  id: verified.user_id || verified.id,
  permissions: verified.permissions || getPermissionsForRole(verified.role),
  store_permissions: verified.store_permissions || getStorePermissions(verified),
});

const buildTenantSummary = (tenant) => ({
  id: tenant.id,
  name: tenant.shop_name,
  plan: tenant.plan_type,
  company_code: tenant.domain || null,
  gst_mode: tenant.gst_mode || 'INCLUSIVE',
});

const normalizeBranchScope = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
};

const hasAllBranchAccess = (user) =>
  user?.all_branch_access === true ||
  user?.all_branch_access === 1 ||
  String(user?.all_branch_access).toLowerCase() === 'true';

const setAccessAuthCookies = (res, accessToken) => {
  setAuthCookie(res, accessToken, DEFAULT_TENANT_COOKIE, getAccessTtlMs());
};

const setRefreshAuthCookie = (res, refreshToken, rememberMe) => {
  setAuthCookie(
    res,
    refreshToken,
    DEFAULT_TENANT_REFRESH_COOKIE,
    getRefreshTtlMs(rememberMe === true)
  );
};

const clearSessionCookies = (res) => {
  clearAuthCookie(res, DEFAULT_TENANT_COOKIE);
  clearAuthCookie(res, DEFAULT_TENANT_REFRESH_COOKIE);
};

const createSessionTokens = async ({
  user,
  tenant,
  tenantPool,
  rememberMe = false,
  deviceId = null,
  branchId = null,
}) => {
  const accessToken = signTenantToken(buildTenantTokenPayload(user, tenant));
  const refresh = await createRefreshToken(tenantPool, {
    userId: user.id,
    tenantId: tenant.id,
    rememberMe,
    deviceId,
    branchId,
  });

  const sessionPayload = {
    user: buildSessionUser(user, tenant),
    tenant: buildTenantSummary(tenant),
    permissions: getPermissionsForRole(user.role),
    store_permissions: getStorePermissions(user),
    remember_me: rememberMe === true,
  };
  const subscriptionInfo = await loadLatestSubscriptionInfo(tenant.id);
  if (subscriptionInfo) sessionPayload.subscription = subscriptionInfo;

  return { accessToken, refresh, sessionPayload };
};

const issueAuthSession = async ({
  res,
  user,
  tenant,
  tenantPool,
  rememberMe = false,
  deviceId = null,
  branchId = null,
}) => {
  const { accessToken, refresh, sessionPayload } = await createSessionTokens({
    user,
    tenant,
    tenantPool,
    rememberMe,
    deviceId,
    branchId,
  });

  setAccessAuthCookies(res, accessToken);
  setRefreshAuthCookie(res, refresh.rawToken, rememberMe);

  // V1 browser auth is credentialed-cookie only. Access and refresh tokens are
  // never returned in JSON where browser JavaScript can persist or inspect them.
  return sessionPayload;
};

const issueMobileAuthSession = async ({
  user,
  tenant,
  tenantPool,
  rememberMe = true,
  deviceId = null,
  branchId = null,
}) => {
  const { accessToken, refresh, sessionPayload } = await createSessionTokens({
    user,
    tenant,
    tenantPool,
    rememberMe,
    deviceId,
    branchId,
  });

  return {
    ...sessionPayload,
    access_token: accessToken,
    refresh_token: refresh.rawToken,
    token_type: 'Bearer',
    expires_in_ms: getAccessTtlMs(),
  };
};

const authenticateTenantLogin = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const companyCode = String(req.body?.company_code || req.body?.domain || '').trim().toLowerCase() || null;
  const tenantIdParam = req.body?.tenant_id || null;

  if (!email || !password) {
    jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required fields');
    return null;
  }

  const resolved = await resolveTenantFromRequest({ email, companyCode, tenantId: tenantIdParam });
  if (resolved.ambiguous) {
    res.status(409).json({
      success: false,
      code: 'COMPANY_SELECTION_REQUIRED',
      message: 'Multiple shops use this email. Please select a company.',
      companies: (resolved.candidates || []).map((c) => ({
        tenant_id: c.id,
        shop_name: c.shop_name,
        company_code: c.company_code || c.domain,
      })),
    });
    return null;
  }

  const tenant = resolved.tenant;
  if (!tenant) {
    jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    return null;
  }
  if (tenant.is_active === false) {
    jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
    return null;
  }

  const tenantPool = getTenantPool(tenant.database_name);
  const userResult = await tenantPool.query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email]
  );
  if (userResult.rowCount === 0) {
    jsonError(res, 401, 'UNAUTHORIZED', 'Invalid email or password');
    return null;
  }

  const user = userResult.rows[0];
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    jsonError(res, 401, 'UNAUTHORIZED', 'Invalid email or password');
    return null;
  }

  const branchIdRaw = req.body?.branch_id || req.headers?.['x-branch-id'] || null;
  const branchId = branchIdRaw && branchIdRaw !== 'all' ? branchIdRaw : null;
  const { deviceId, deviceInfo } = sanitizeDeviceContext(req);
  if (branchId && !hasAllBranchAccess(user) && normalizeBranchScope(user.branch_id) !== normalizeBranchScope(branchId)) {
    jsonError(res, 403, 'POS_DEVICE_BRANCH_FORBIDDEN', 'POS device is outside the user branch scope');
    return null;
  }
  if (branchId && deviceId) {
    const deviceResult = await ensureDeviceRegistration({
      tenantPool,
      branchId,
      deviceId,
      userId: user.id,
      mode: 'validate',
      deviceInfo
    });
    if (!deviceResult.allowed) {
      if (deviceResult.code === 'DEVICE_LIMIT_REACHED') {
        jsonError(
          res,
          403,
          'DEVICE_LIMIT_REACHED',
          'Device limit reached for this branch. Please remove an existing device or upgrade your plan.'
        );
        return null;
      }
      jsonError(res, 403, 'DEVICE_NOT_ALLOWED', 'Access denied from this device');
      return null;
    }
  }

  const rememberMe =
    req.body?.remember_me === undefined || req.body?.remember_me === null
      ? true
      : req.body?.remember_me === true ||
        req.body?.remember_me === 1 ||
        String(req.body?.remember_me).toLowerCase() === 'true';

  return { user, tenant, tenantPool, rememberMe, deviceId, branchId };
};

const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required fields');
    }

    const { tenant } = await resolveTenantFromRequest({ email });
    if (!tenant) return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    if (tenant.is_active === false) {
      return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
    }

    const tenantPool = getTenantPool(tenant.database_name);
    const userCheck = await tenantPool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rowCount > 0) {
      return jsonError(res, 409, 'USER_EXISTS', 'User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const safeRole = role === 'admin' || role === 'staff' ? role : 'staff';
    const newUser = await tenantPool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, branch_id, all_branch_access`,
      [name, email, hashedPassword, safeRole]
    );

    return jsonOk(res, newUser.rows[0], 'User registered');
  } catch (error) {
    return jsonError(res, 500, 'REGISTER_FAILED', error.message);
  }
};

const login = async (req, res) => {
  try {
    const auth = await authenticateTenantLogin(req, res);
    if (!auth) return;

    const session = await issueAuthSession({
      res,
      ...auth,
    });

    return res.status(200).json({
      success: true,
      ...session,
    });
  } catch (error) {
    return jsonError(res, 500, 'LOGIN_FAILED', error.message);
  }
};

const mobileLogin = async (req, res) => {
  try {
    const auth = await authenticateTenantLogin(req, res);
    if (!auth) return;

    const session = await issueMobileAuthSession(auth);

    return res.status(200).json({
      success: true,
      ...session,
    });
  } catch (error) {
    return jsonError(res, 500, 'MOBILE_LOGIN_FAILED', error.message);
  }
};

const rotateRefreshSession = async (rawRefreshToken, res, { clearCookiesOnDisabled = false } = {}) => {
  if (!rawRefreshToken) {
    jsonError(res, 401, 'UNAUTHORIZED', 'Refresh token missing');
    return null;
  }

  const tenantId = parseRefreshTenantId(rawRefreshToken);
  if (!tenantId) {
    jsonError(res, 401, 'UNAUTHORIZED', 'Invalid refresh token');
    return null;
  }

  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    jsonError(res, 401, 'UNAUTHORIZED', 'Invalid refresh token');
    return null;
  }
  if (tenant.is_active === false) {
    if (clearCookiesOnDisabled) clearSessionCookies(res);
    jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
    return null;
  }

  const tenantPool = getTenantPool(tenant.database_name);
  const rotated = await consumeAndRotateRefreshToken(tenantPool, rawRefreshToken, tenant.id);
  if (!rotated) {
    jsonError(res, 401, 'UNAUTHORIZED', 'Invalid, expired, or already used refresh token');
    return null;
  }

  const row = rotated.row;
  const user = {
    id: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    branch_id: row.branch_id || null,
    all_branch_access: row.all_branch_access !== false,
  };

  const accessToken = signTenantToken(buildTenantTokenPayload(user, tenant));
  return {
    accessToken,
    rawRefreshToken: rotated.rawToken,
    rememberMe: row.remember_me === true,
    user,
    tenant,
  };
};

const refresh = async (req, res) => {
  try {
    const rawRefreshToken = req?.cookies?.[DEFAULT_TENANT_REFRESH_COOKIE];
    const rotated = await rotateRefreshSession(rawRefreshToken, res, { clearCookiesOnDisabled: true });
    if (!rotated) return;

    setAccessAuthCookies(res, rotated.accessToken);
    setRefreshAuthCookie(res, rotated.rawRefreshToken, rotated.rememberMe);

    return res.status(200).json({
      success: true,
      user: buildSessionUser(rotated.user, rotated.tenant),
      tenant: buildTenantSummary(rotated.tenant),
      permissions: getPermissionsForRole(rotated.user.role),
      store_permissions: getStorePermissions(rotated.user),
      remember_me: rotated.rememberMe,
    });
  } catch (error) {
    return jsonError(res, 500, 'REFRESH_FAILED', error.message);
  }
};

const mobileRefresh = async (req, res) => {
  try {
    const rawRefreshToken = req.body?.refresh_token || req.headers?.['x-refresh-token'] || null;
    const rotated = await rotateRefreshSession(rawRefreshToken, res);
    if (!rotated) return;

    return res.status(200).json({
      success: true,
      access_token: rotated.accessToken,
      refresh_token: rotated.rawRefreshToken,
      token_type: 'Bearer',
      expires_in_ms: getAccessTtlMs(),
      user: buildSessionUser(rotated.user, rotated.tenant),
      tenant: buildTenantSummary(rotated.tenant),
      permissions: getPermissionsForRole(rotated.user.role),
      store_permissions: getStorePermissions(rotated.user),
      remember_me: rotated.rememberMe,
    });
  } catch (error) {
    return jsonError(res, 500, 'MOBILE_REFRESH_FAILED', error.message);
  }
};

const getLogin = async (req, res) => {
  if (!req.user) return jsonError(res, 401, 'UNAUTHORIZED', 'Not authenticated');

  try {
    const branchIdRaw = req.headers['x-branch-id'] || null;
    const branchId = branchIdRaw && branchIdRaw !== 'all' ? branchIdRaw : null;
    const { deviceId, deviceInfo } = sanitizeDeviceContext(req);
    if (branchId && deviceId) {
      const deviceResult = await ensureDeviceRegistration({
        tenantPool: req.tenantPool,
        branchId,
        deviceId,
        userId: req.user?.user_id || req.user?.id,
        mode: 'validate',
        deviceInfo
      });
      if (!deviceResult.allowed) {
        if (deviceResult.code === 'DEVICE_LIMIT_REACHED') {
          return jsonError(
            res,
            403,
            'DEVICE_LIMIT_REACHED',
            'Device limit reached for this branch. Please remove an existing device or upgrade your plan.'
          );
        }
        return jsonError(res, 403, 'DEVICE_NOT_ALLOWED', 'Access denied from this device');
      }
    }
    return res.status(200).json({
      success: true,
      user: buildVerifiedSessionUser(req.user),
      permissions: getPermissionsForRole(req.user.role),
      store_permissions: getStorePermissions(req.user),
    });
  } catch (error) {
    return jsonError(res, 403, 'UNAUTHORIZED', 'Invalid token');
  }
};

const logout = async (req, res) => {
  try {
    const rawRefreshToken = req?.cookies?.[DEFAULT_TENANT_REFRESH_COOKIE];
    let tenantPool = req.tenantPool || null;
    if (!tenantPool && rawRefreshToken) {
      const tenantId = parseRefreshTenantId(rawRefreshToken);
      const tenant = tenantId ? await getTenantById(tenantId) : null;
      if (tenant) {
        tenantPool = getTenantPool(tenant.database_name);
      }
    }
    if (rawRefreshToken && tenantPool) {
      await revokeRefreshToken(tenantPool, rawRefreshToken);
    }
    clearSessionCookies(res);
    return res.status(200).json({ success: true, message: 'Logged out' });
  } catch (error) {
    clearSessionCookies(res);
    return jsonError(res, 500, 'LOGOUT_FAILED', error.message);
  }
};

const mobileLogout = async (req, res) => {
  try {
    const rawRefreshToken = req.body?.refresh_token || req?.cookies?.[DEFAULT_TENANT_REFRESH_COOKIE] || null;
    let tenantPool = req.tenantPool || null;
    if (!tenantPool && rawRefreshToken) {
      const tenantId = parseRefreshTenantId(rawRefreshToken);
      const tenant = tenantId ? await getTenantById(tenantId) : null;
      if (tenant) {
        tenantPool = getTenantPool(tenant.database_name);
      }
    }
    if (rawRefreshToken && tenantPool) {
      await revokeRefreshToken(tenantPool, rawRefreshToken);
    }
    return res.status(200).json({ success: true, message: 'Logged out' });
  } catch (error) {
    return jsonError(res, 500, 'MOBILE_LOGOUT_FAILED', error.message);
  }
};

module.exports = {
  register,
  login,
  mobileLogin,
  refresh,
  mobileRefresh,
  getLogin,
  logout,
  mobileLogout,
  issueMobileAuthSession,
};
