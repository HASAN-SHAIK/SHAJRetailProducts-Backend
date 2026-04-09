const pool = require('../db');
const { resolveBranchIdFromRequest, normalizeBranchId } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const normalizeStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'active' || status === 'inactive') return status;
  return 'active';
};

const addStaff = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(payload.branch_id);
  const id = payload.staffId || payload.id;
  const name = String(payload.name || '').trim();
  const phone = String(payload.phone || '').trim() || null;
  const role = String(payload.role || '').trim() || null;
  const salary = payload.salary !== undefined ? Number(payload.salary) : null;
  const joinDate = payload.joinDate ? new Date(payload.joinDate) : null;
  const status = normalizeStatus(payload.status);

  if (!id) throw buildValidationError('staffId is required.');
  if (!name) throw buildValidationError('name is required.');
  if (salary !== null && (!Number.isFinite(salary) || salary < 0)) {
    throw buildValidationError('salary must be >= 0.');
  }
  if (joinDate && Number.isNaN(joinDate.getTime())) {
    throw buildValidationError('joinDate is invalid.');
  }

  const result = await requestPool.query(
    `INSERT INTO staff (id, name, phone, role, salary, join_date, status, branch_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         role = EXCLUDED.role,
         salary = EXCLUDED.salary,
         join_date = EXCLUDED.join_date,
         status = EXCLUDED.status,
         branch_id = EXCLUDED.branch_id,
         updated_at = NOW()
     RETURNING id AS "staffId",
               name,
               phone,
               role,
               salary,
               join_date AS "joinDate",
               status,
               branch_id AS "branchId",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    [id, name, phone, role, salary, joinDate, status, branchId]
  );

  return result.rows[0];
};

const getStaff = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(query.branch_id);
  const status = String(query.status || '').trim().toLowerCase();
  const search = String(query.search || '').trim();

  const values = [];
  const conditions = [];
  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(name ILIKE $${values.length} OR phone ILIKE $${values.length})`);
  }
  if (branchId) {
    values.push(branchId);
    conditions.push(`branch_id = $${values.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await requestPool.query(
    `SELECT id AS "staffId",
            name,
            phone,
            role,
            salary,
            join_date AS "joinDate",
            status,
            branch_id AS "branchId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM staff
     ${whereClause}
     ORDER BY created_at DESC`,
    values
  );

  return result.rows;
};

const updateStaff = async (req, id, payload = {}) => {
  if (!id) throw buildValidationError('staffId is required.');
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(payload.branch_id);
  const name = payload.name !== undefined ? String(payload.name || '').trim() : null;
  const phone = payload.phone !== undefined ? String(payload.phone || '').trim() || null : undefined;
  const role = payload.role !== undefined ? String(payload.role || '').trim() || null : undefined;
  const salary = payload.salary !== undefined ? Number(payload.salary) : undefined;
  const joinDate = payload.joinDate ? new Date(payload.joinDate) : undefined;
  const status = payload.status !== undefined ? normalizeStatus(payload.status) : undefined;

  if (name !== null && !name) throw buildValidationError('name is required.');
  if (salary !== undefined && (!Number.isFinite(salary) || salary < 0)) {
    throw buildValidationError('salary must be >= 0.');
  }
  if (joinDate && Number.isNaN(joinDate.getTime())) {
    throw buildValidationError('joinDate is invalid.');
  }

  const fields = [];
  const values = [];
  if (name !== null) {
    values.push(name);
    fields.push(`name = $${values.length}`);
  }
  if (phone !== undefined) {
    values.push(phone);
    fields.push(`phone = $${values.length}`);
  }
  if (role !== undefined) {
    values.push(role);
    fields.push(`role = $${values.length}`);
  }
  if (salary !== undefined) {
    values.push(salary);
    fields.push(`salary = $${values.length}`);
  }
  if (joinDate !== undefined) {
    values.push(joinDate || null);
    fields.push(`join_date = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    fields.push(`status = $${values.length}`);
  }
  if (branchId) {
    values.push(branchId);
    fields.push(`branch_id = $${values.length}`);
  }

  values.push(id);
  const result = await requestPool.query(
    `UPDATE staff
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING id AS "staffId",
               name,
               phone,
               role,
               salary,
               join_date AS "joinDate",
               status,
               branch_id AS "branchId",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    values
  );

  if (result.rowCount === 0) {
    throw buildValidationError('staff not found.');
  }
  return result.rows[0];
};

const deleteStaff = async (req, id) => {
  if (!id) throw buildValidationError('staffId is required.');
  const requestPool = getRequestPool(req);
  await requestPool.query(`DELETE FROM staff WHERE id = $1`, [id]);
};

module.exports = { addStaff, getStaff, updateStaff, deleteStaff };
