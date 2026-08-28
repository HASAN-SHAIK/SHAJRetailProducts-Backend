const bcrypt = require('bcryptjs');
const { jsonError, jsonOk } = require('../../utils/responses');
const { ROLE_PERMISSIONS } = require('../../utils/rolePermissions');

const currentUserId = (req) => Number(req?.user?.user_id || req?.user?.id || 0);
const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
};

const validateRole = (role) => Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
const supportedRoleMessage = `role must be one of: ${Object.keys(ROLE_PERMISSIONS).join(', ')}`;

const assertBranch = async (pool, branchId) => {
  if (!branchId) return null;
  const result = await pool.query('SELECT id FROM branches WHERE id = $1 LIMIT 1', [branchId]);
  if (!result.rowCount) {
    const error = new Error('Branch not found');
    error.status = 400;
    throw error;
  }
  return branchId;
};

const listUsers = async (req, res) => {
  try {
    const result = await req.tenantPool.query(
      `SELECT u.id,
              u.name,
              u.email,
              u.role,
              u.branch_id,
              u.all_branch_access,
              b.name AS branch_name,
              b.store_number,
              u.created_at
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       ORDER BY u.created_at ASC, u.id ASC`
    );
    return jsonOk(res, { users: result.rows });
  } catch (error) {
    return jsonError(res, 500, 'USER_LIST_FAILED', error.message);
  }
};

const createUser = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role = normalizeRole(req.body?.role || 'staff');
    let branchId = req.body?.branch_id || null;
    let allBranchAccess = parseBoolean(req.body?.all_branch_access, role === 'admin');

    if (!name || !email || !password) return jsonError(res, 400, 'VALIDATION_ERROR', 'name, email and password are required');
    if (password.length < 8) return jsonError(res, 400, 'VALIDATION_ERROR', 'password must be at least 8 characters');
    if (!validateRole(role)) return jsonError(res, 400, 'VALIDATION_ERROR', supportedRoleMessage);

    if (role === 'admin') allBranchAccess = true;
    if (allBranchAccess) branchId = null;
    if (!allBranchAccess && !branchId) return jsonError(res, 400, 'VALIDATION_ERROR', 'branch_id is required when all_branch_access is false');
    branchId = await assertBranch(req.tenantPool, branchId);

    const existing = await req.tenantPool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    if (existing.rowCount) return jsonError(res, 409, 'USER_EXISTS', 'User already exists');

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await req.tenantPool.query(
      `INSERT INTO users (name, email, password, role, branch_id, all_branch_access)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, branch_id, all_branch_access, created_at`,
      [name, email, hashedPassword, role, branchId, allBranchAccess]
    );
    return jsonOk(res, { user: result.rows[0] }, 'User created');
  } catch (error) {
    if (error?.status) return jsonError(res, error.status, 'VALIDATION_ERROR', error.message);
    if (error?.code === '23505') return jsonError(res, 409, 'USER_EXISTS', 'User already exists');
    return jsonError(res, 500, 'USER_CREATE_FAILED', error.message);
  }
};

const updateUserRole = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid user id');
    const role = normalizeRole(req.body?.role);
    if (!validateRole(role)) return jsonError(res, 400, 'VALIDATION_ERROR', supportedRoleMessage);

    if (userId === currentUserId(req) && role !== 'admin') {
      return jsonError(res, 409, 'SELF_DEMOTION_BLOCKED', 'You cannot remove your own admin access');
    }

    const target = await req.tenantPool.query('SELECT id, role FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (!target.rowCount) return jsonError(res, 404, 'USER_NOT_FOUND', 'User not found');
    if (target.rows[0].role === 'admin' && role !== 'admin') {
      const admins = await req.tenantPool.query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'`);
      if (Number(admins.rows[0]?.count || 0) <= 1) {
        return jsonError(res, 409, 'LAST_ADMIN_REQUIRED', 'At least one tenant administrator is required');
      }
    }

    const result = await req.tenantPool.query(
      `UPDATE users
       SET role = $1,
           all_branch_access = CASE WHEN $1 = 'admin' THEN TRUE ELSE all_branch_access END,
           branch_id = CASE WHEN $1 = 'admin' THEN NULL ELSE branch_id END
       WHERE id = $2
       RETURNING id, name, email, role, branch_id, all_branch_access, created_at`,
      [role, userId]
    );
    return jsonOk(res, { user: result.rows[0] }, 'User role updated');
  } catch (error) {
    return jsonError(res, 500, 'USER_ROLE_UPDATE_FAILED', error.message);
  }
};

const updateUserAccess = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid user id');
    const target = await req.tenantPool.query('SELECT id, role FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (!target.rowCount) return jsonError(res, 404, 'USER_NOT_FOUND', 'User not found');

    let allBranchAccess = parseBoolean(req.body?.all_branch_access, false);
    let branchId = req.body?.branch_id || null;
    if (target.rows[0].role === 'admin') allBranchAccess = true;
    if (allBranchAccess) branchId = null;
    if (!allBranchAccess && !branchId) return jsonError(res, 400, 'VALIDATION_ERROR', 'branch_id is required when all_branch_access is false');
    branchId = await assertBranch(req.tenantPool, branchId);

    const result = await req.tenantPool.query(
      `UPDATE users
       SET branch_id = $1, all_branch_access = $2
       WHERE id = $3
       RETURNING id, name, email, role, branch_id, all_branch_access, created_at`,
      [branchId, allBranchAccess, userId]
    );
    return jsonOk(res, { user: result.rows[0] }, 'User access updated');
  } catch (error) {
    if (error?.status) return jsonError(res, error.status, 'VALIDATION_ERROR', error.message);
    return jsonError(res, 500, 'USER_ACCESS_UPDATE_FAILED', error.message);
  }
};

module.exports = { listUsers, createUser, updateUserRole, updateUserAccess };
