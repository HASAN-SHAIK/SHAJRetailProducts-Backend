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

const toDateOnlyString = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const addStaff = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(payload.branch_id || payload.branchId);
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
               branch_id,
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
    conditions.push(`s.status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(s.name ILIKE $${values.length} OR s.phone ILIKE $${values.length} OR s.role ILIKE $${values.length})`);
  }
  if (branchId) {
    values.push(branchId);
    conditions.push(`s.branch_id = $${values.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await requestPool.query(
    `SELECT s.id AS "staffId",
            s.name,
            s.phone,
            s.role,
            s.salary,
            s.join_date AS "joinDate",
            s.status,
            s.branch_id AS "branchId",
            s.branch_id,
            b.name AS "branchName",
            b.store_number AS "storeNumber",
            s.created_at AS "createdAt",
            s.updated_at AS "updatedAt"
     FROM staff s
     LEFT JOIN branches b ON b.id = s.branch_id
     ${whereClause}
     ORDER BY s.created_at DESC`,
    values
  );

  return result.rows;
};

const updateStaff = async (req, id, payload = {}) => {
  if (!id) throw buildValidationError('staffId is required.');
  const requestPool = getRequestPool(req);
  const hasBranchPayload = Object.prototype.hasOwnProperty.call(payload, 'branch_id') || Object.prototype.hasOwnProperty.call(payload, 'branchId');
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(payload.branch_id || payload.branchId);
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
  if (hasBranchPayload || branchId) {
    values.push(branchId || null);
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
               branch_id,
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

const getStaffPerformance = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(query.branch_id);
  const from = toDateOnlyString(query.from);
  const to = toDateOnlyString(query.to);
  const month = String(query.month || '').trim();

  const branchFilter = branchId ? 'AND s.branch_id = $1' : '';
  const staffParams = branchId ? [branchId] : [];
  const staffResult = await requestPool.query(
    `SELECT s.id AS "staffId",
            s.name,
            s.role,
            s.status,
            s.salary,
            s.branch_id AS "branchId",
            b.name AS "branchName",
            COALESCE(sa.net_salary, 0)::numeric AS "netSalary",
            COALESCE(sa.paid_amount, 0)::numeric AS "paidAmount",
            COALESCE(sa.pending_amount, 0)::numeric AS "pendingAmount",
            COALESCE(ex.expense_total, 0)::numeric AS "expenseTotal",
            COALESCE(ex.expense_count, 0)::integer AS "expenseCount"
     FROM staff s
     LEFT JOIN branches b ON b.id = s.branch_id
     LEFT JOIN (
       SELECT staff_id,
              SUM(net_salary) AS net_salary,
              SUM(paid_amount) AS paid_amount,
              SUM(pending_amount) AS pending_amount
       FROM salaries
       WHERE ($${staffParams.length + 1}::text IS NULL OR month = $${staffParams.length + 1})
       GROUP BY staff_id
     ) sa ON sa.staff_id = s.id
     LEFT JOIN (
       SELECT staff_id,
              SUM(amount) AS expense_total,
              COUNT(*) AS expense_count
       FROM expenses
       WHERE type = 'staff'
         AND ($${staffParams.length + 2}::date IS NULL OR date >= $${staffParams.length + 2})
         AND ($${staffParams.length + 3}::date IS NULL OR date <= $${staffParams.length + 3})
       GROUP BY staff_id
     ) ex ON ex.staff_id = s.id
     WHERE 1 = 1 ${branchFilter}
     ORDER BY s.name ASC`,
    [...staffParams, month || null, from, to]
  );

  const userParams = [];
  const userConditions = [`u.role IN ('cashier', 'manager', 'staff')`];
  if (branchId) {
    userParams.push(branchId);
    userConditions.push(`(u.all_branch_access = TRUE OR u.branch_id = $${userParams.length})`);
  }
  const orderBranchParam = userParams.length + 1;
  const orderFromParam = userParams.length + 2;
  const orderToParam = userParams.length + 3;

  const userResult = await requestPool.query(
    `SELECT u.id AS "userId",
            u.name,
            u.email,
            u.role,
            u.branch_id AS "branchId",
            u.all_branch_access AS "allBranchAccess",
            b.name AS "branchName",
            COALESCE(SUM(CASE WHEN o.transaction_type = 'sale' THEN o.total_price ELSE 0 END), 0)::numeric AS "salesTotal",
            COUNT(o.id)::integer AS "orderCount"
     FROM users u
     LEFT JOIN branches b ON b.id = u.branch_id
     LEFT JOIN orders o ON o.user_id = u.id
       AND o.transaction_type = 'sale'
       AND o.is_deleted = FALSE
       AND ($${orderBranchParam}::uuid IS NULL OR o.branch_id = $${orderBranchParam})
       AND ($${orderFromParam}::date IS NULL OR o.created_at::date >= $${orderFromParam})
       AND ($${orderToParam}::date IS NULL OR o.created_at::date <= $${orderToParam})
     WHERE ${userConditions.join(' AND ')}
     GROUP BY u.id, u.name, u.email, u.role, u.branch_id, u.all_branch_access, b.name
     ORDER BY "salesTotal" DESC, "orderCount" DESC, u.name ASC`,
    [...userParams, branchId || null, from, to]
  );

  const profiles = staffResult.rows.map((row) => ({
    ...row,
    source: 'Staff profile',
    salary: Number(row.salary || 0),
    netSalary: Number(row.netSalary || 0),
    paidAmount: Number(row.paidAmount || 0),
    pendingAmount: Number(row.pendingAmount || 0),
    expenseTotal: Number(row.expenseTotal || 0),
    expenseCount: Number(row.expenseCount || 0),
    salesTotal: 0,
    orderCount: 0,
  }));
  const loginUsers = userResult.rows.map((row) => ({
    ...row,
    source: 'Login user',
    salesTotal: Number(row.salesTotal || 0),
    orderCount: Number(row.orderCount || 0),
    salary: 0,
    netSalary: 0,
    paidAmount: 0,
    pendingAmount: 0,
    expenseTotal: 0,
    expenseCount: 0,
  }));

  const rows = [...loginUsers, ...profiles];
  return {
    rows,
    summary: {
      totalSales: loginUsers.reduce((sum, row) => sum + row.salesTotal, 0),
      totalOrders: loginUsers.reduce((sum, row) => sum + row.orderCount, 0),
      totalSalaryPayable: profiles.reduce((sum, row) => sum + row.netSalary, 0),
      totalSalaryPending: profiles.reduce((sum, row) => sum + row.pendingAmount, 0),
      totalStaffExpenses: profiles.reduce((sum, row) => sum + row.expenseTotal, 0),
    },
  };
};

module.exports = { addStaff, getStaff, updateStaff, deleteStaff, getStaffPerformance };
