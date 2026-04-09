const pool = require('../db');
const { resolveBranchIdFromRequest, normalizeBranchId } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const normalizeMonth = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw;
};

const resolvePaymentStatus = (netSalary, paidAmount) => {
  if (!Number.isFinite(netSalary) || netSalary <= 0) return 'pending';
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) return 'pending';
  if (paidAmount >= netSalary) return 'paid';
  return 'partial';
};

const buildSalaryValues = (payload = {}) => {
  const baseSalary = Number(payload.baseSalary ?? payload.base_salary ?? 0) || 0;
  const bonus = Number(payload.bonus ?? 0) || 0;
  const deductions = Number(payload.deductions ?? 0) || 0;
  const netSalary = Number(payload.netSalary ?? (baseSalary + bonus - deductions)) || 0;
  const paidAmount = Number(payload.paidAmount ?? payload.paid_amount ?? 0) || 0;
  const pendingAmount =
    payload.pendingAmount ?? payload.pending_amount ?? Math.max(netSalary - paidAmount, 0);
  const paymentStatus = payload.paymentStatus || resolvePaymentStatus(netSalary, paidAmount);
  return {
    baseSalary,
    bonus,
    deductions,
    netSalary,
    paidAmount,
    pendingAmount,
    paymentStatus,
  };
};

const addSalary = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(payload.branch_id);
  const id = payload.salaryId || payload.id;
  const staffId = payload.staffId || payload.staff_id;
  const month = normalizeMonth(payload.month);

  if (!id) throw buildValidationError('salaryId is required.');
  if (!staffId) throw buildValidationError('staffId is required.');
  if (!month) throw buildValidationError('month is required.');

  const values = buildSalaryValues(payload);

  const result = await requestPool.query(
    `INSERT INTO salaries
      (id, staff_id, month, base_salary, bonus, deductions, net_salary, paid_amount, pending_amount, payment_status, branch_id, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
     SET staff_id = EXCLUDED.staff_id,
         month = EXCLUDED.month,
         base_salary = EXCLUDED.base_salary,
         bonus = EXCLUDED.bonus,
         deductions = EXCLUDED.deductions,
         net_salary = EXCLUDED.net_salary,
         paid_amount = EXCLUDED.paid_amount,
         pending_amount = EXCLUDED.pending_amount,
         payment_status = EXCLUDED.payment_status,
         branch_id = EXCLUDED.branch_id,
         updated_at = NOW()
     RETURNING id AS "salaryId",
               staff_id AS "staffId",
               month,
               base_salary AS "baseSalary",
               bonus,
               deductions,
               net_salary AS "netSalary",
               paid_amount AS "paidAmount",
               pending_amount AS "pendingAmount",
               payment_status AS "paymentStatus",
               branch_id AS "branchId",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    [
      id,
      staffId,
      month,
      values.baseSalary,
      values.bonus,
      values.deductions,
      values.netSalary,
      values.paidAmount,
      values.pendingAmount,
      values.paymentStatus,
      branchId,
    ]
  );

  return result.rows[0];
};

const getSalaries = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(query.branch_id);
  const staffId = query.staffId || query.staff_id;
  const month = normalizeMonth(query.month);

  const values = [];
  const conditions = [];
  if (staffId) {
    values.push(staffId);
    conditions.push(`staff_id = $${values.length}`);
  }
  if (month) {
    values.push(month);
    conditions.push(`month = $${values.length}`);
  }
  if (branchId) {
    values.push(branchId);
    conditions.push(`branch_id = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await requestPool.query(
    `SELECT id AS "salaryId",
            staff_id AS "staffId",
            month,
            base_salary AS "baseSalary",
            bonus,
            deductions,
            net_salary AS "netSalary",
            paid_amount AS "paidAmount",
            pending_amount AS "pendingAmount",
            payment_status AS "paymentStatus",
            branch_id AS "branchId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM salaries
     ${whereClause}
     ORDER BY created_at DESC`,
    values
  );

  return result.rows;
};

const updateSalary = async (req, id, payload = {}) => {
  if (!id) throw buildValidationError('salaryId is required.');
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(payload.branch_id);
  const staffId = payload.staffId ?? payload.staff_id;
  const month = payload.month;
  const values = buildSalaryValues(payload);

  const fields = [];
  const params = [];

  if (staffId !== undefined) {
    params.push(staffId);
    fields.push(`staff_id = $${params.length}`);
  }
  if (month !== undefined) {
    params.push(month);
    fields.push(`month = $${params.length}`);
  }

  params.push(values.baseSalary);
  fields.push(`base_salary = $${params.length}`);
  params.push(values.bonus);
  fields.push(`bonus = $${params.length}`);
  params.push(values.deductions);
  fields.push(`deductions = $${params.length}`);
  params.push(values.netSalary);
  fields.push(`net_salary = $${params.length}`);
  params.push(values.paidAmount);
  fields.push(`paid_amount = $${params.length}`);
  params.push(values.pendingAmount);
  fields.push(`pending_amount = $${params.length}`);
  params.push(values.paymentStatus);
  fields.push(`payment_status = $${params.length}`);

  if (branchId) {
    params.push(branchId);
    fields.push(`branch_id = $${params.length}`);
  }

  params.push(id);

  const result = await requestPool.query(
    `UPDATE salaries
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING id AS "salaryId",
               staff_id AS "staffId",
               month,
               base_salary AS "baseSalary",
               bonus,
               deductions,
               net_salary AS "netSalary",
               paid_amount AS "paidAmount",
               pending_amount AS "pendingAmount",
               payment_status AS "paymentStatus",
               branch_id AS "branchId",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    params
  );

  if (result.rowCount === 0) throw buildValidationError('salary not found.');
  return result.rows[0];
};

const deleteSalary = async (req, id) => {
  if (!id) throw buildValidationError('salaryId is required.');
  const requestPool = getRequestPool(req);
  await requestPool.query(`DELETE FROM salaries WHERE id = $1`, [id]);
};

module.exports = { addSalary, getSalaries, updateSalary, deleteSalary };
