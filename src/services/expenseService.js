const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const { resolveBranchIdFromRequest, normalizeBranchId } = require('../utils/branch');

const normalizeType = (value) => String(value || '').trim().toLowerCase();

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const addExpense = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(payload.branch_id);
  const type = normalizeType(payload.type);
  const name = String(payload.name || '').trim();
  const description = String(payload.description || '').trim();
  const amount = Number(payload.amount);
  const date = payload.date ? new Date(payload.date) : null;

  if (!type || !['staff', 'shop'].includes(type)) {
    throw buildValidationError('type must be staff or shop.');
  }
  if (!name) {
    throw buildValidationError('name is required.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw buildValidationError('amount must be > 0.');
  }
  if (date && Number.isNaN(date.getTime())) {
    throw buildValidationError('date is invalid.');
  }

  const result = await requestPool.query(
    `INSERT INTO expenses (type, name, amount, description, date, branch_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6)
     RETURNING id, type, name, amount, description, date, created_at, branch_id`,
    [type, name, amount, description || null, date, branchId]
  );

  return result.rows[0];
};

const getExpenses = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(query.branch_id);
  const type = normalizeType(query.type);
  const name = String(query.name || '').trim();
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;

  if (from && Number.isNaN(from.getTime())) {
    throw buildValidationError('from is invalid.');
  }
  if (to && Number.isNaN(to.getTime())) {
    throw buildValidationError('to is invalid.');
  }

  const conditions = [];
  const values = [];

  if (type && ['staff', 'shop'].includes(type)) {
    values.push(type);
    conditions.push(`type = $${values.length}`);
  }
  if (name) {
    values.push(`%${name}%`);
    conditions.push(`name ILIKE $${values.length}`);
  }
  if (from) {
    values.push(from);
    conditions.push(`date >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    conditions.push(`date <= $${values.length}`);
  }
  if (branchId) {
    values.push(branchId);
    conditions.push(`branch_id = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await requestPool.query(
    `SELECT id, type, name, amount, description, date, created_at, branch_id
     FROM expenses
     ${whereClause}
     ORDER BY date DESC, created_at DESC`,
    values
  );

  return result.rows;
};

const getSummary = async (req) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(req.query?.branch_id);
  const dailyRes = await requestPool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
     FROM expenses
     WHERE date = CURRENT_DATE
       AND ($1::uuid IS NULL OR branch_id = $1)`,
    [branchId]
  );
  const monthlyRes = await requestPool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
     FROM expenses
     WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
       AND ($1::uuid IS NULL OR branch_id = $1)`,
    [branchId]
  );

  return {
    daily_total: Number(dailyRes.rows[0]?.total || 0),
    monthly_total: Number(monthlyRes.rows[0]?.total || 0)
  };
};

module.exports = { addExpense, getExpenses, getSummary };
