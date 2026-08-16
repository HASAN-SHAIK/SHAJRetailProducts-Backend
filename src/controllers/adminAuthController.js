const bcrypt = require('bcryptjs');
const masterPool = require('../db/masterPool');
const { jsonError } = require('../utils/responses');
const {
  DEFAULT_ADMIN_COOKIE,
  signAdminToken,
  setAuthCookie,
  clearAuthCookie
} = require('../utils/jwt');

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required fields');
    }

    const adminRes = await masterPool.query(
      'SELECT id, name, email, password, role FROM platform_admins WHERE email = $1',
      [email]
    );
    if (adminRes.rowCount === 0) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    const admin = adminRes.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password);
    if (!validPassword) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    const token = signAdminToken({
      type: 'admin',
      admin_id: admin.id,
      role: admin.role || 'platform_admin'
    });

    setAuthCookie(
      res,
      token,
      DEFAULT_ADMIN_COOKIE,
      Number(process.env.ADMIN_TOKEN_COOKIE_MAX_AGE_MS || 4 * 60 * 60 * 1000)
    );

    return res.status(200).json({
      success: true,
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
    });
  } catch (error) {
    return jsonError(res, 500, 'ADMIN_LOGIN_FAILED', error.message);
  }
};

const adminMe = async (req, res) => {
  if (!req.admin) return jsonError(res, 401, 'UNAUTHORIZED', 'Not authenticated');
  return res.status(200).json({ success: true, admin: req.admin });
};

const createAdmin = async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'name, email, password are required');
    }

    const normalizedRole = role ? role.toString().trim().toLowerCase() : 'platform_admin';
    if (!['platform_admin', 'super_admin'].includes(normalizedRole)) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'role must be platform_admin or super_admin');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await masterPool.query(
      `INSERT INTO platform_admins (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [name, email.toString().trim().toLowerCase(), hashedPassword, normalizedRole]
    );

    return res.status(201).json({ success: true, admin: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return jsonError(res, 409, 'ADMIN_EXISTS', 'Email already exists');
    }
    return jsonError(res, 500, 'ADMIN_CREATE_FAILED', error.message);
  }
};

const adminLogout = async (req, res) => {
  try {
    clearAuthCookie(res, DEFAULT_ADMIN_COOKIE);
    return res.status(200).json({ success: true, message: 'Logged out' });
  } catch (error) {
    return jsonError(res, 500, 'LOGOUT_FAILED', error.message);
  }
};

module.exports = { adminLogin, adminMe, adminLogout, createAdmin };
