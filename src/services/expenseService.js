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
  const id = payload.expenseId || payload.id || null;
  const type = normalizeType(payload.type);
  const category = String(payload.category || payload.name || '').trim();
  const staffId = payload.staffId || payload.staff_id || null;
  const paymentMethod = String(payload.paymentMethod || payload.payment_method || '').trim() || null;
  const notes = String(payload.notes || payload.description || '').trim() || null;
  const amount = Number(payload.amount);
  const date = payload.date ? new Date(payload.date) : null;

  if (!type || !['staff', 'shop'].includes(type)) {
    throw buildValidationError('type must be staff or shop.');
  }
  if (!category) throw buildValidationError('category is required.');
  if (type === 'staff' && !staffId) {
    throw buildValidationError('staffId is required for staff expenses.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw buildValidationError('amount must be > 0.');
  }
  if (date && Number.isNaN(date.getTime())) {
    throw buildValidationError('date is invalid.');
  }

  const result = await requestPool.query(
    `INSERT INTO expenses (id, type, name, category, amount, description, notes, staff_id, payment_method, date, branch_id, created_at, updated_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $6, $7, $8, COALESCE($9, CURRENT_DATE), $10, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
     SET type = EXCLUDED.type,
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         amount = EXCLUDED.amount,
         description = EXCLUDED.description,
         notes = EXCLUDED.notes,
         staff_id = EXCLUDED.staff_id,
         payment_method = EXCLUDED.payment_method,
         date = EXCLUDED.date,
         branch_id = EXCLUDED.branch_id,
         updated_at = NOW()
     RETURNING id AS "expenseId",
               type,
               category,
               amount,
               staff_id AS "staffId",
               payment_method AS "paymentMethod",
               notes,
               date,
               created_at AS "createdAt",
               updated_at AS "updatedAt",
               branch_id AS "branchId"`,
    [id, type, category, category, amount, notes, staffId, paymentMethod, date, branchId]
  );

  return result.rows[0];
};

const getExpenses = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(query.branch_id);
  const type = normalizeType(query.type);
  const category = String(query.category || query.name || '').trim();
  const staffId = query.staffId || query.staff_id;
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
  if (category) {
    values.push(`%${category}%`);
    conditions.push(`category ILIKE $${values.length}`);
  }
  if (staffId) {
    values.push(staffId);
    conditions.push(`staff_id = $${values.length}`);
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
    `SELECT id AS "expenseId",
            type,
            category,
            amount,
            staff_id AS "staffId",
            payment_method AS "paymentMethod",
            notes,
            date,
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            branch_id AS "branchId"
     FROM expenses
     ${whereClause}
     ORDER BY date DESC, created_at DESC`,
    values
  );

  return result.rows;
};

const getDailyReport = async (req) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(req.query?.branch_id);
  const date = req.query?.date ? new Date(req.query.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw buildValidationError('date is invalid.');
  }
  const totalRes = await requestPool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
     FROM expenses
     WHERE date = $1
       AND ($2::uuid IS NULL OR branch_id = $2)`,
    [date, branchId]
  );
  const categoryRes = await requestPool.query(
    `SELECT category, COALESCE(SUM(amount), 0)::numeric AS total
     FROM expenses
     WHERE date = $1
       AND ($2::uuid IS NULL OR branch_id = $2)
     GROUP BY category
     ORDER BY total DESC`,
    [date, branchId]
  );

  return {
    date: date.toISOString().slice(0, 10),
    total: Number(totalRes.rows[0]?.total || 0),
    categories: categoryRes.rows.map((row) => ({
      category: row.category || 'Uncategorized',
      total: Number(row.total || 0),
    })),
  };
};

const getMonthlyReport = async (req) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req) || normalizeBranchId(req.query?.branch_id);
  const rawMonth = String(req.query?.month || '').trim();
  const month = rawMonth || new Date().toISOString().slice(0, 7);
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(monthStart.getTime())) {
    throw buildValidationError('month is invalid.');
  }
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  monthEnd.setUTCDate(0);

  const totalRes = await requestPool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
     FROM expenses
     WHERE date >= $1 AND date <= $2
       AND ($3::uuid IS NULL OR branch_id = $3)`,
    [monthStart, monthEnd, branchId]
  );
  const categoryRes = await requestPool.query(
    `SELECT category, COALESCE(SUM(amount), 0)::numeric AS total
     FROM expenses
     WHERE date >= $1 AND date <= $2
       AND ($3::uuid IS NULL OR branch_id = $3)
     GROUP BY category
     ORDER BY total DESC`,
    [monthStart, monthEnd, branchId]
  );

  return {
    month,
    total: Number(totalRes.rows[0]?.total || 0),
    categories: categoryRes.rows.map((row) => ({
      category: row.category || 'Uncategorized',
      total: Number(row.total || 0),
    })),
  };
};

module.exports = { addExpense, getExpenses, getDailyReport, getMonthlyReport };
