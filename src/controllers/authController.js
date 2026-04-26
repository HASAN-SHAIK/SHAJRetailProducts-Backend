const bcrypt = require('bcryptjs');
const { getTenantByDomain } = require('../services/tenantService');
const { getTenantPool } = require('../db/tenantPool');
const { jsonError, jsonOk } = require('../utils/responses');
const {
  DEFAULT_TENANT_COOKIE,
  signTenantToken,
  setAuthCookie,
  clearAuthCookie
} = require('../utils/jwt');
const { ensureDeviceRegistration, sanitizeDeviceContext } = require('../utils/branchDeviceLicensing');
require('dotenv').config();

const resolveTenantFromRequest = async ({ email }) => {
  if (email && email.includes('@')) {
    const domain = email.split('@')[1].trim().toLowerCase();
    const cleanDomain = domain.replace(/\.com$/, ''); // Remove .com suffix if present
    if (cleanDomain) {
      console.log(`Resolving tenant for domain: ${cleanDomain}`);
      return getTenantByDomain(cleanDomain);
    }
  }
  return null;
};

const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required fields');
    }

    const tenant = await resolveTenantFromRequest({ email });
    if (!tenant) return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');

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
        mode: 'register',
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

    const token = signTenantToken({
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
      all_branch_access: user.all_branch_access !== false
    });

    setAuthCookie(
      res,
      token,
      DEFAULT_TENANT_COOKIE,
      Number(process.env.TOKEN_COOKIE_MAX_AGE_MS || 8 * 60 * 60 * 1000)
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branch_id: user.branch_id || null,
        all_branch_access: user.all_branch_access !== false
      },
      tenant: { id: tenant.id, name: tenant.shop_name, plan: tenant.plan_type }
    });
  } catch (error) {
    return jsonError(res, 500, 'LOGIN_FAILED', error.message);
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
        mode: 'register',
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
    return res.status(200).json({ success: true, user: req.user });
  } catch (error) {
    return jsonError(res, 403, 'UNAUTHORIZED', 'Invalid token');
  }
};

const logout = async (req, res) => {
  try {
    clearAuthCookie(res, DEFAULT_TENANT_COOKIE);
    return res.status(200).json({ success: true, message: 'Logged out' });
  } catch (error) {
    return jsonError(res, 500, 'LOGOUT_FAILED', error.message);
  }
};

module.exports = { register, login, getLogin, logout };
