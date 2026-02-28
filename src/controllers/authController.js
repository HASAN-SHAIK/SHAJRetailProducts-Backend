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
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
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

    const token = signTenantToken({
      type: 'tenant',
      user_id: user.id,
      tenant_id: tenant.id,
      role: user.role,
      user_name: user.name
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
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: { id: tenant.id, name: tenant.shop_name, plan: tenant.plan_type }
    });
  } catch (error) {
    return jsonError(res, 500, 'LOGIN_FAILED', error.message);
  }
};

const getLogin = async (req, res) => {
  if (!req.user) return jsonError(res, 401, 'UNAUTHORIZED', 'Not authenticated');

  try {
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
