const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const { getDateRange } = require('../utils/dateRange');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
};

const normalizePaymentMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'cash';
  if (raw === 'upi' || raw === 'online') return 'online';
  if (raw === 'bank') return 'bank';
  return raw;
};

const createReceipt = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const client = await requestPool.connect();
  try {
    const customerId = normalizeNumber(payload.customer_id);
    const amount = normalizeNumber(payload.amount);
    if (!Number.isFinite(customerId)) throw buildValidationError('customer_id is required.');
    if (!Number.isFinite(amount) || amount <= 0) throw buildValidationError('amount must be > 0.');
    const paymentMode = normalizePaymentMode(payload.payment_mode || payload.paymentMode);
    const notes = payload.notes || null;
    const branchId = resolveBranchIdFromRequest(req);

    await client.query('BEGIN');
    const customerRes = await client.query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (customerRes.rowCount === 0) throw buildValidationError('customer_id is invalid.');

    const insertRes = await client.query(
      `INSERT INTO transactions (order_id, total_price, payment_mode, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id)
       VALUES (NULL, $1, $2, NOW(), $1, 'customer', $3, 'in', 'receipt', $4, $5)
       RETURNING id, created_at`,
      [amount, paymentMode, customerId, notes, branchId]
    );

    await client.query(
      `UPDATE customers
       SET current_balance = GREATEST(COALESCE(current_balance, 0) - $1, 0),
           updated_at = NOW()
       WHERE id = $2`,
      [amount, customerId]
    );

    await client.query('COMMIT');
    return { id: insertRes.rows[0]?.id, created_at: insertRes.rows[0]?.created_at };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const createPayment = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const client = await requestPool.connect();
  try {
    const supplierId = normalizeNumber(payload.supplier_id);
    const amount = normalizeNumber(payload.amount);
    if (!Number.isFinite(supplierId)) throw buildValidationError('supplier_id is required.');
    if (!Number.isFinite(amount) || amount <= 0) throw buildValidationError('amount must be > 0.');
    const paymentMode = normalizePaymentMode(payload.payment_mode || payload.paymentMode);
    const notes = payload.notes || null;
    const branchId = resolveBranchIdFromRequest(req);

    await client.query('BEGIN');
    const supplierRes = await client.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
    if (supplierRes.rowCount === 0) throw buildValidationError('supplier_id is invalid.');

    const insertRes = await client.query(
      `INSERT INTO transactions (order_id, total_price, payment_mode, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id)
       VALUES (NULL, $1, $2, NOW(), $1, 'supplier', $3, 'out', 'payment', $4, $5)
       RETURNING id, created_at`,
      [amount, paymentMode, supplierId, notes, branchId]
    );

    await client.query(
      `UPDATE suppliers
       SET current_balance = GREATEST(COALESCE(current_balance, 0) - $1, 0)
       WHERE id = $2`,
      [amount, supplierId]
    );

    await client.query('COMMIT');
    return { id: insertRes.rows[0]?.id, created_at: insertRes.rows[0]?.created_at };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const buildBookQuery = (paymentModes = []) => {
  const modes = paymentModes.map((value) => String(value).toLowerCase());
  return {
    modes,
    clause: modes.length ? `LOWER(t.payment_mode) = ANY($3)` : '1=1',
  };
};

const getCashOrBankBook = async (req, options = {}) => {
  const requestPool = getRequestPool(req);
  const { range, start_date: startDateRaw, end_date: endDateRaw, page, limit } = options || {};
  const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
  const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const offset = (resolvedPage - 1) * resolvedLimit;
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = resolveBranchIdFromRequest(req);
  const { clause, modes } = buildBookQuery(options.payment_modes || []);

  const query = `
    SELECT t.id,
           t.created_at,
           t.txn_type,
           t.direction,
           COALESCE(t.amount, t.total_price, 0) AS amount,
           t.payment_mode,
           t.notes,
           t.party_type,
           t.party_id,
           COALESCE(t.branch_id, o.branch_id) AS branch_id,
           COALESCE(c.name, s.name) AS party_name,
           SUM(
             CASE
               WHEN LOWER(COALESCE(t.direction, 'in')) = 'in' THEN COALESCE(t.amount, t.total_price, 0)
               WHEN LOWER(COALESCE(t.direction, 'in')) = 'out' THEN -COALESCE(t.amount, t.total_price, 0)
               ELSE 0
             END
           ) OVER (ORDER BY t.created_at ASC, t.id ASC) AS running_balance
    FROM transactions t
    LEFT JOIN orders o ON o.id = t.order_id
    LEFT JOIN customers c ON c.id = t.party_id AND t.party_type = 'customer'
    LEFT JOIN suppliers s ON s.id = t.party_id AND t.party_type = 'supplier'
    WHERE t.created_at BETWEEN $1 AND $2
      AND (${clause})
      AND ($4::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $4)
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT $5 OFFSET $6;
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM transactions t
    LEFT JOIN orders o ON o.id = t.order_id
    WHERE t.created_at BETWEEN $1 AND $2
      AND (${clause})
      AND ($4::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $4);
  `;

  const params = [start, end, modes, branchId, resolvedLimit, offset];
  const countParams = [start, end, modes, branchId];

  const [rowsRes, countRes] = await Promise.all([
    requestPool.query(query, params),
    requestPool.query(countQuery, countParams)
  ]);

  return {
    entries: rowsRes.rows,
    page: resolvedPage,
    limit: resolvedLimit,
    total: countRes.rows[0]?.total || 0,
  };
};

const getCashBook = async (req, query = {}) =>
  getCashOrBankBook(req, { ...query, payment_modes: ['cash'] });

const getBankBook = async (req, query = {}) =>
  getCashOrBankBook(req, { ...query, payment_modes: ['bank', 'upi', 'online'] });

const getLedger = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const partyType = String(query.party_type || query.partyType || '').toLowerCase();
  const partyId = normalizeNumber(query.party_id || query.partyId);
  if (!partyType || !['customer', 'supplier'].includes(partyType)) {
    throw buildValidationError('party_type must be customer or supplier.');
  }
  if (!Number.isFinite(partyId)) {
    throw buildValidationError('party_id is required.');
  }
  const { range, start_date: startDateRaw, end_date: endDateRaw, page, limit } = query || {};
  const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
  const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const offset = (resolvedPage - 1) * resolvedLimit;
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = resolveBranchIdFromRequest(req);

  const ledgerQuery = `
    SELECT t.id,
           t.created_at,
           t.txn_type,
           t.direction,
           COALESCE(t.amount, t.total_price, 0) AS amount,
           t.payment_mode,
           t.notes,
           SUM(
             CASE
               WHEN $1 = 'customer' THEN
                 CASE
                   WHEN t.txn_type = 'sale' THEN COALESCE(t.amount, t.total_price, 0)
                   WHEN t.txn_type IN ('receipt', 'refund') THEN -COALESCE(t.amount, t.total_price, 0)
                   WHEN LOWER(COALESCE(t.direction, 'in')) = 'in' THEN COALESCE(t.amount, t.total_price, 0)
                   WHEN LOWER(COALESCE(t.direction, 'in')) = 'out' THEN -COALESCE(t.amount, t.total_price, 0)
                   ELSE 0
                 END
               ELSE
                 CASE
                   WHEN t.txn_type = 'purchase' THEN COALESCE(t.amount, t.total_price, 0)
                   WHEN t.txn_type IN ('payment', 'refund') THEN -COALESCE(t.amount, t.total_price, 0)
                   WHEN LOWER(COALESCE(t.direction, 'in')) = 'out' THEN COALESCE(t.amount, t.total_price, 0)
                   WHEN LOWER(COALESCE(t.direction, 'in')) = 'in' THEN -COALESCE(t.amount, t.total_price, 0)
                   ELSE 0
                 END
             END
           ) OVER (ORDER BY t.created_at ASC, t.id ASC) AS running_balance
    FROM transactions t
    LEFT JOIN orders o ON o.id = t.order_id
    WHERE t.party_type = $1
      AND t.party_id = $2
      AND t.created_at BETWEEN $3 AND $4
      AND ($5::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $5)
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT $6 OFFSET $7;
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM transactions t
    LEFT JOIN orders o ON o.id = t.order_id
    WHERE t.party_type = $1
      AND t.party_id = $2
      AND t.created_at BETWEEN $3 AND $4
      AND ($5::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $5);
  `;

  const params = [partyType, partyId, start, end, branchId, resolvedLimit, offset];
  const countParams = [partyType, partyId, start, end, branchId];

  const [rowsRes, countRes] = await Promise.all([
    requestPool.query(ledgerQuery, params),
    requestPool.query(countQuery, countParams)
  ]);

  const entries = rowsRes.rows.map((row) => {
    const amount = Number(row.amount || 0);
    if (partyType === 'customer') {
      const debit = row.txn_type === 'sale' ? amount : 0;
      const credit = row.txn_type === 'receipt' || row.txn_type === 'refund' ? amount : 0;
      return { ...row, debit, credit, balance: Number(row.running_balance || 0) };
    }
    const credit = row.txn_type === 'purchase' ? amount : 0;
    const debit = row.txn_type === 'payment' || row.txn_type === 'refund' ? amount : 0;
    return { ...row, debit, credit, balance: Number(row.running_balance || 0) };
  });

  return {
    entries,
    page: resolvedPage,
    limit: resolvedLimit,
    total: countRes.rows[0]?.total || 0,
  };
};

const getOutstanding = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const partyType = String(query.party_type || query.partyType || '').toLowerCase();
  const partyId = query.party_id || query.partyId || null;
  const branchId = resolveBranchIdFromRequest(req);

  if (partyType && !['customer', 'supplier'].includes(partyType)) {
    throw buildValidationError('party_type must be customer or supplier.');
  }

  const baseParams = [];
  let idx = 1;
  const partyFilter = [];
  if (partyId) {
    partyFilter.push(`t.party_id = $${idx}`);
    baseParams.push(partyId);
    idx += 1;
  }
  if (partyType) {
    partyFilter.push(`t.party_type = $${idx}`);
    baseParams.push(partyType);
    idx += 1;
  }
  const partyClause = partyFilter.length ? `AND ${partyFilter.join(' AND ')}` : '';

  const branchClause = `AND ($${idx}::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $${idx})`;
  baseParams.push(branchId);

  const queryText = `
    SELECT t.party_type,
           t.party_id,
           COALESCE(c.name, s.name) AS party_name,
           SUM(CASE WHEN t.txn_type = 'sale' THEN COALESCE(t.amount, t.total_price, 0) ELSE 0 END) AS total_debit,
           SUM(CASE WHEN t.txn_type = 'receipt' THEN COALESCE(t.amount, t.total_price, 0) ELSE 0 END) AS total_credit,
           SUM(CASE WHEN t.txn_type = 'purchase' THEN COALESCE(t.amount, t.total_price, 0) ELSE 0 END) AS total_payable,
           SUM(CASE WHEN t.txn_type = 'payment' THEN COALESCE(t.amount, t.total_price, 0) ELSE 0 END) AS total_payment
    FROM transactions t
    LEFT JOIN orders o ON o.id = t.order_id
    LEFT JOIN customers c ON c.id = t.party_id AND t.party_type = 'customer'
    LEFT JOIN suppliers s ON s.id = t.party_id AND t.party_type = 'supplier'
    WHERE 1=1
      ${partyClause}
      ${branchClause}
    GROUP BY t.party_type, t.party_id, party_name
    ORDER BY party_name ASC;
  `;

  const result = await requestPool.query(queryText, baseParams);
  const rows = result.rows.map((row) => {
    const debit = Number(row.total_debit || 0);
    const credit = Number(row.total_credit || 0);
    const payable = Number(row.total_payable || 0);
    const payment = Number(row.total_payment || 0);
    if (row.party_type === 'supplier') {
      const outstanding = payable - payment;
      return {
        party_type: row.party_type,
        party_id: row.party_id,
        party_name: row.party_name,
        total_debit: payment,
        total_credit: payable,
        outstanding,
      };
    }
    const outstanding = debit - credit;
    return {
      party_type: row.party_type,
      party_id: row.party_id,
      party_name: row.party_name,
      total_debit: debit,
      total_credit: credit,
      outstanding,
    };
  });

  return { rows };
};

module.exports = {
  createReceipt,
  createPayment,
  getCashBook,
  getBankBook,
  getLedger,
  getOutstanding,
};
