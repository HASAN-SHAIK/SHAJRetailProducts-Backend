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
require('dotenv').config();

const parseRefreshTenantId = (rawToken) => {
  const text = String(rawToken || '');
  const separatorIndex = text.indexOf('.');
  if (separatorIndex <= 0) return null;
  return text.slice(0, separatorIndex);
};

const resolveTenantFromRequest = async ({ email }) => {
  if (email && email.includes('@')) {
    const domain = email.split('@')[1].trim().toLowerCase();
    const cleanDomain = domain.replace(/\.com$/, '');
    if (cleanDomain) {
      console.log(`Resolving tenant for domain: ${cleanDomain}`);
      return getTenantByDomain(cleanDomain);
    }
  }
  return null;
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

const issueAuthSession = async ({
  res,
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

  setAccessAuthCookies(res, accessToken);
  setRefreshAuthCookie(res, refresh.rawToken, rememberMe);

  // V1 browser auth is credentialed-cookie only. Access and refresh tokens are
  // never returned in JSON where browser JavaScript can persist or inspect them.
  return {
    user: buildSessionUser(user, tenant),
    tenant: { id: tenant.id, name: tenant.shop_name, plan: tenant.plan_type },
    permissions: getPermissionsForRole(user.role),
    store_permissions: getStorePermissions(user),
    remember_me: rememberMe === true,
  };
};

const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required fields');
    }

    const tenant = await resolveTenantFromRequest({ email });
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
    const { email, password } = req.body;
    if (!email || !password) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required fields');
    }

    const tenant = await resolveTenantFromRequest({ email });
    if (!tenant) return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    if (tenant.is_active === false) {
      return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
    }

    const tenantPool = getTenantPool(tenant.database_name);
    const userResult = await tenantPool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rowCount === 0) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    const branchIdRaw = req.body?.branch_id || req.headers['x-branch-id'] || null;
    const branchId = branchIdRaw && branchIdRaw !== 'all' ? branchIdRaw : null;
    const { deviceId, deviceInfo } = sanitizeDeviceContext(req);
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

    const rememberMe =
      req.body?.remember_me === undefined || req.body?.remember_me === null
        ? true
        : req.body?.remember_me === true ||
          req.body?.remember_me === 1 ||
          String(req.body?.remember_me).toLowerCase() === 'true';

    const session = await issueAuthSession({
      res,
      user,
      tenant,
      tenantPool,
      rememberMe,
      deviceId,
      branchId,
    });

    return res.status(200).json({
      success: true,
      ...session,
    });
  } catch (error) {
    return jsonError(res, 500, 'LOGIN_FAILED', error.message);
  }
};

const refresh = async (req, res) => {
  try {
    const rawRefreshToken = req?.cookies?.[DEFAULT_TENANT_REFRESH_COOKIE];
    if (!rawRefreshToken) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Refresh token missing');
    }

    const tenantId = parseRefreshTenantId(rawRefreshToken);
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid refresh token');
    }

    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid refresh token');
    }
    if (tenant.is_active === false) {
      clearSessionCookies(res);
      return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
    }

    const tenantPool = getTenantPool(tenant.database_name);
    const rotated = await consumeAndRotateRefreshToken(tenantPool, rawRefreshToken, tenant.id);
    if (!rotated) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid, expired, or already used refresh token');
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
    setAccessAuthCookies(res, accessToken);
    setRefreshAuthCookie(res, rotated.rawToken, row.remember_me === true);

    return res.status(200).json({
      success: true,
      user: buildSessionUser(user, tenant),
      tenant: { id: tenant.id, name: tenant.shop_name, plan: tenant.plan_type },
      permissions: getPermissionsForRole(user.role),
      store_permissions: getStorePermissions(user),
      remember_me: row.remember_me === true,
    });
  } catch (error) {
    return jsonError(res, 500, 'REFRESH_FAILED', error.message);
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

module.exports = { register, login, refresh, getLogin, logout };
