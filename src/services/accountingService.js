const pool = require('../db');
const crypto = require('crypto');
const getRequestPool = (req) => req.tenantPool || pool;
const { getDateRange } = require('../utils/dateRange');
const { resolveBranchIdFromRequest } = require('../utils/branch');
const {
  buildValidationError,
  normalizeNumber,
  resolveCashBankLedgerName,
  getExistingTxnByClientTxnId,
  insertLedgerEntries,
} = require('./ledgerPostingService');
 
const parseNumberInput = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
};

const normalizePaymentMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'cash';
  if (raw === 'upi' || raw === 'online') return 'online';
  if (raw === 'bank') return 'bank';
  if (raw === 'card') return 'cash';
  return raw;
};

const normalizeOrderStatusForBalance = ({ total, paid, returned }) => {
  const gross = Number(total || 0);
  const paidAmount = Number(paid || 0);
  const returnedAmount = Number(returned || 0);
  const remaining = Math.max(gross - paidAmount - returnedAmount, 0);
  return remaining <= 0 ? 'completed' : 'pending';
};

const createReceipt = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const client = await requestPool.connect();
  try {
    const customerId = parseNumberInput(payload.customer_id);
    const amount = parseNumberInput(payload.amount);
    if (!Number.isFinite(customerId)) throw buildValidationError('customer_id is required.');
    if (!Number.isFinite(amount) || amount <= 0) throw buildValidationError('amount must be > 0.');
    const orderId = parseNumberInput(payload.order_id || payload.orderId);
    const paymentMode = normalizePaymentMode(payload.payment_mode || payload.paymentMode);
    const normalizedMode = paymentMode === 'upi' ? 'online' : paymentMode;
    if (!['cash', 'bank', 'online'].includes(normalizedMode)) {
      throw buildValidationError('payment_mode must be cash, bank, or online for receipt entry.');
    }
    const notes = payload.notes || null;
    const branchId = payload.branch_id || payload.branchId || resolveBranchIdFromRequest(req);
    const date = payload.date || payload.created_at || null;
    const clientTxnId = payload.client_txn_id || payload.clientTxnId || null;
    if (!clientTxnId) throw buildValidationError('client_txn_id is required.');

    await client.query('BEGIN');
    const existingTxn = await getExistingTxnByClientTxnId(client, clientTxnId);
    if (existingTxn) {
      await client.query('COMMIT');
      return { id: existingTxn.id, created_at: existingTxn.created_at, idempotent: true };
    }

    const customerRes = await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
    if (customerRes.rowCount === 0) throw buildValidationError('customer_id is invalid.');

    const insertRes = await client.query(
      `INSERT INTO transactions (order_id, total_price, payment_mode, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id, client_txn_id)
       VALUES ($1, $2, $3, COALESCE($4, NOW()), $2, 'customer', $5, 'in', 'receipt', $6, $7, $8)
       RETURNING id, created_at`,
      [Number.isFinite(orderId) ? orderId : null, amount, normalizedMode, date, customerId, notes, branchId, clientTxnId]
    );

    await insertLedgerEntries({
      client,
      lines: [
        { ledger: resolveCashBankLedgerName(normalizedMode), debit: amount, credit: 0 },
        { ledger: 'Accounts Receivable', debit: 0, credit: amount },
      ],
      transactionId: insertRes.rows[0]?.id || null,
      referenceId: Number.isFinite(orderId) ? orderId : null,
      referenceType: 'payment',
      description: notes || `Receipt from customer #${customerId}`,
      date,
      branchId,
      clientTxnId,
      syncStatus: 'SYNCED',
      partyType: 'customer',
      partyId: customerId,
    });

    if (Number.isFinite(orderId)) {
      const orderRes = await client.query(
        `SELECT id, total_price, total_paid, returned_amount
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );
      if (orderRes.rowCount > 0) {
        const orderRow = orderRes.rows[0];
        const total = Number(orderRow.total_price || 0);
        const paid = Number(orderRow.total_paid || 0);
        const returned = Number(orderRow.returned_amount || 0);
        const nextTotalPaid = paid + amount;
        const nextStatus = normalizeOrderStatusForBalance({ total, paid: nextTotalPaid, returned });
        await client.query(
          `UPDATE orders
           SET total_paid = $1, order_status = $2
           WHERE id = $3`,
          [nextTotalPaid, nextStatus, orderId]
        );
      }
    }

    await client.query('COMMIT');
    return {
      id: insertRes.rows[0]?.id,
      created_at: insertRes.rows[0]?.created_at,
      order_id: Number.isFinite(orderId) ? orderId : null,
    };
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
    const type = String(payload.type || 'supplier').trim().toLowerCase();
    const supplierId = parseNumberInput(payload.supplier_id);
    const amount = parseNumberInput(payload.amount);
    if (!['supplier', 'expense', 'drawings'].includes(type)) throw buildValidationError('type must be supplier, expense, or drawings.');
    if (type === 'supplier' && !Number.isFinite(supplierId)) throw buildValidationError('supplier_id is required.');
    if (!Number.isFinite(amount) || amount <= 0) throw buildValidationError('amount must be > 0.');
    const orderId = parseNumberInput(payload.order_id || payload.orderId);
    const paymentMode = normalizePaymentMode(payload.payment_mode || payload.paymentMode);
    const normalizedMode = paymentMode === 'upi' ? 'online' : paymentMode;
    if (!['cash', 'bank', 'online'].includes(normalizedMode)) {
      throw buildValidationError('payment_mode must be cash, bank, or online for payment entry.');
    }
    const notes = payload.notes || null;
    const branchId = payload.branch_id || payload.branchId || resolveBranchIdFromRequest(req);
    const date = payload.date || payload.created_at || null;
    const clientTxnId = payload.client_txn_id || payload.clientTxnId || null;
    const expenseCategory = payload.expense_category || payload.expenseCategory || null;
    if (!clientTxnId) throw buildValidationError('client_txn_id is required.');

    await client.query('BEGIN');
    const existingTxn = await getExistingTxnByClientTxnId(client, clientTxnId);
    if (existingTxn) {
      await client.query('COMMIT');
      return { id: existingTxn.id, created_at: existingTxn.created_at, idempotent: true };
    }

    if (type === 'supplier') {
      const supplierRes = await client.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
      if (supplierRes.rowCount === 0) throw buildValidationError('supplier_id is invalid.');
    }

    const insertRes = await client.query(
      `INSERT INTO transactions (order_id, total_price, payment_mode, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id, client_txn_id)
       VALUES ($1, $2, $3, COALESCE($4, NOW()), $2, $5, $6, 'out', 'payment', $7, $8, $9)
       RETURNING id, created_at`,
      [
        Number.isFinite(orderId) ? orderId : null,
        amount,
        normalizedMode,
        date,
        type === 'supplier' ? 'supplier' : 'expense',
        type === 'supplier' ? supplierId : null,
        notes,
        branchId,
        clientTxnId
      ]
    );

    const debitLedger = type === 'supplier'
      ? 'Accounts Payable'
      : type === 'drawings'
      ? 'Drawings Account'
      : (() => {
          const raw = String(expenseCategory || '').toLowerCase();
          if (raw.includes('rent')) return 'Rent';
          if (raw.includes('sal')) return 'Salaries';
          return 'Misc Expense';
        })();

    await insertLedgerEntries({
      client,
      lines: [
        { ledger: debitLedger, debit: amount, credit: 0 },
        { ledger: resolveCashBankLedgerName(normalizedMode), debit: 0, credit: amount },
      ],
      transactionId: insertRes.rows[0]?.id || null,
      referenceId: Number.isFinite(orderId) ? orderId : (type === 'supplier' ? supplierId : null),
      referenceType: type === 'supplier' ? 'payment' : (type === 'drawings' ? 'drawings' : 'expense'),
      description: notes || `${type === 'supplier' ? 'Supplier' : type === 'drawings' ? 'Drawings' : 'Expense'} payment`,
      date,
      branchId,
      clientTxnId,
      syncStatus: 'SYNCED',
      partyType: type === 'supplier' ? 'supplier' : 'expense',
      partyId: type === 'supplier' ? supplierId : null,
    });

    if (type === 'supplier' && Number.isFinite(orderId)) {
      const purchaseRes = await client.query(
        `SELECT id, total_price, total_paid
         FROM orders
         WHERE id = $1 AND transaction_type = 'purchase'
         FOR UPDATE`,
        [orderId]
      );
      if (purchaseRes.rowCount > 0) {
        const purchase = purchaseRes.rows[0];
        const totalPrice = Number(purchase.total_price || 0);
        const totalPaid = Number(purchase.total_paid || 0);
        const nextTotalPaid = totalPaid + amount;
        const nextStatus = nextTotalPaid >= totalPrice ? 'completed' : 'pending';
        await client.query(
          `UPDATE orders
           SET total_paid = $1, order_status = $2
           WHERE id = $3`,
          [nextTotalPaid, nextStatus, orderId]
        );
      }
    }

    await client.query('COMMIT');
    return {
      id: insertRes.rows[0]?.id,
      created_at: insertRes.rows[0]?.created_at,
      order_id: Number.isFinite(orderId) ? orderId : null
    };
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
  (() => getLedgerBook(req, { ...query, ledger_name: 'Cash in Hand' }))();

const getBankBook = async (req, query = {}) =>
  (() => getLedgerBook(req, { ...query, ledger_name: 'Bank Account' }))();

const getLedgerBook = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const { range, start_date: startDateRaw, end_date: endDateRaw, branch_id: branchIdRaw, ledger_id: ledgerIdRaw, ledger_name: ledgerNameRaw } = query || {};
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = branchIdRaw || resolveBranchIdFromRequest(req);
  const ledgerName = String(ledgerNameRaw || '').trim();
  const ledgerId = typeof ledgerIdRaw === 'string' && ledgerIdRaw.trim() ? ledgerIdRaw.trim() : null;

  const openingRes = await requestPool.query(
    `SELECT COALESCE(SUM(le.debit - le.credit), 0)::numeric AS opening_balance
     FROM ledger_entries le
     JOIN ledgers l ON l.id = le.ledger_id
     WHERE ($1::text = '' OR l.name = $1)
       AND ($2::uuid IS NULL OR l.id = $2::uuid)
       AND ($3::uuid IS NULL OR le.branch_id = $3 OR le.branch_id IS NULL)
       AND le.date < $4`,
    [ledgerName, ledgerId, branchId, start]
  );

  const rowsRes = await requestPool.query(
    `SELECT *
     FROM (
       SELECT le.id,
              le.date,
              le.created_at,
              le.description,
              le.debit,
              le.credit,
              le.reference_id,
              le.reference_type,
              le.transaction_id,
              le.branch_id,
              l.id AS ledger_id,
              l.name AS ledger_name,
              CASE WHEN LOWER(COALESCE(le.reference_type, '')) = 'opening' THEN 0 ELSE 1 END AS order_rank,
              (COALESCE(SUM(le.debit - le.credit) OVER (
                ORDER BY
                  le.date ASC,
                  CASE WHEN LOWER(COALESCE(le.reference_type, '')) = 'opening' THEN 0 ELSE 1 END ASC,
                  le.created_at ASC,
                  le.id ASC
              ), 0) + $4::numeric) AS running_balance
       FROM ledger_entries le
       JOIN ledgers l ON l.id = le.ledger_id
       WHERE ($1::text = '' OR l.name = $1)
         AND ($2::uuid IS NULL OR l.id = $2::uuid)
         AND ($3::uuid IS NULL OR le.branch_id = $3 OR le.branch_id IS NULL)
         AND le.date BETWEEN $5 AND $6
     ) t
     ORDER BY
       t.date DESC,
       t.order_rank DESC,
       t.created_at DESC,
       t.id DESC`,
    [ledgerName, ledgerId, branchId, Number(openingRes.rows[0]?.opening_balance || 0), start, end]
  );

  return {
    opening_balance: Number(openingRes.rows[0]?.opening_balance || 0),
    entries: rowsRes.rows.map((row) => ({ ...row, debit: Number(row.debit || 0), credit: Number(row.credit || 0), running_balance: Number(row.running_balance || 0) })),
  };
};

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
    SELECT *
    FROM (
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
             ) OVER (
               ORDER BY t.created_at ASC, t.id ASC
             ) AS running_balance
      FROM transactions t
      LEFT JOIN orders o ON o.id = t.order_id
      WHERE t.party_type = $1
        AND t.party_id = $2
        AND t.created_at BETWEEN $3 AND $4
        AND ($5::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $5)
    ) x
    ORDER BY x.created_at DESC, x.id DESC
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
  const type = String(query.type || query.party_type || query.partyType || '').trim().toLowerCase();
  const branchId = query.branch_id || query.branchId || resolveBranchIdFromRequest(req) || null;
  if (type && !['customer', 'supplier'].includes(type)) {
    throw buildValidationError('type must be customer or supplier.');
  }

  const resolvedType = type || 'customer';
  if (resolvedType === 'customer') {
    const customerRes = await requestPool.query(
      `SELECT
          c.id::text AS id,
          c.name AS name,
          COALESCE(SUM(le.debit), 0)::numeric AS total_debit,
          COALESCE(SUM(le.credit), 0)::numeric AS total_credit,
          COALESCE(SUM(le.debit - le.credit), 0)::numeric AS outstanding
       FROM ledger_entries le
       JOIN ledgers l ON l.id = le.ledger_id
       JOIN customers c ON c.id = le.party_id
       WHERE l.name = 'Accounts Receivable'
         AND le.party_type = 'customer'
         AND ($1::uuid IS NULL OR le.branch_id = $1)
       GROUP BY c.id, c.name
       HAVING COALESCE(SUM(le.debit - le.credit), 0) != 0
       ORDER BY outstanding DESC, c.name ASC`,
      [branchId]
    );
    return {
      rows: customerRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        total_debit: Number(row.total_debit || 0),
        total_credit: Number(row.total_credit || 0),
        outstanding: Number(row.outstanding || 0),
      })),
    };
  }

  const supplierRes = await requestPool.query(
    `SELECT
        s.id::text AS id,
        s.name AS name,
        COALESCE(SUM(le.debit), 0)::numeric AS total_debit,
        COALESCE(SUM(le.credit), 0)::numeric AS total_credit,
        COALESCE(SUM(le.credit - le.debit), 0)::numeric AS outstanding
     FROM ledger_entries le
     JOIN ledgers l ON l.id = le.ledger_id
     JOIN suppliers s ON s.id = le.party_id
     WHERE l.name = 'Accounts Payable'
       AND le.party_type = 'supplier'
       AND ($1::uuid IS NULL OR le.branch_id = $1)
     GROUP BY s.id, s.name
     HAVING COALESCE(SUM(le.credit - le.debit), 0) != 0
     ORDER BY outstanding DESC, s.name ASC`,
    [branchId]
  );
  return {
    rows: supplierRes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      total_debit: Number(row.total_debit || 0),
      total_credit: Number(row.total_credit || 0),
      outstanding: Number(row.outstanding || 0),
    })),
  };
};

const getTrialBalance = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const { range, start_date: startDateRaw, end_date: endDateRaw } = query || {};
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = resolveBranchIdFromRequest(req);
  const res = await requestPool.query(
    `SELECT l.id,
            l.name,
            l.type,
            COALESCE(SUM(le.debit), 0)::numeric AS total_debit,
            COALESCE(SUM(le.credit), 0)::numeric AS total_credit,
            (COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0))::numeric AS net_balance
     FROM ledgers l
     LEFT JOIN ledger_entries le
       ON le.ledger_id = l.id
      AND le.date BETWEEN $1 AND $2
      AND ($3::uuid IS NULL OR le.branch_id = $3 OR le.branch_id IS NULL)
     GROUP BY l.id, l.name, l.type
     ORDER BY l.type, l.name`,
    [start, end, branchId]
  );
  return { rows: res.rows };
};

const getProfitAndLoss = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const { range, start_date: startDateRaw, end_date: endDateRaw } = query || {};
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = resolveBranchIdFromRequest(req);
  const res = await requestPool.query(
    `SELECT l.id,
            l.name,
            l.type,
            COALESCE(SUM(le.debit), 0)::numeric AS total_debit,
            COALESCE(SUM(le.credit), 0)::numeric AS total_credit
     FROM ledgers l
     JOIN ledger_entries le ON le.ledger_id = l.id
     WHERE l.type IN ('INCOME', 'EXPENSE')
       AND le.date BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR le.branch_id = $3 OR le.branch_id IS NULL)
     GROUP BY l.id, l.name, l.type
     ORDER BY l.type, l.name`,
    [start, end, branchId]
  );
  let totalIncome = 0;
  let totalExpense = 0;
  const rows = res.rows.map((row) => {
    const debit = Number(row.total_debit || 0);
    const credit = Number(row.total_credit || 0);
    const net = row.type === 'INCOME' ? credit - debit : debit - credit;
    if (row.type === 'INCOME') totalIncome += net;
    if (row.type === 'EXPENSE') totalExpense += net;
    return { ...row, net_amount: net };
  });
  return {
    rows,
    summary: {
      total_income: totalIncome,
      total_expense: totalExpense,
      net_profit: totalIncome - totalExpense
    }
  };
};

const getBalanceSheet = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const { range, start_date: startDateRaw, end_date: endDateRaw } = query || {};
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = resolveBranchIdFromRequest(req);
  const res = await requestPool.query(
    `SELECT l.id,
            l.name,
            l.type,
            COALESCE(SUM(le.debit), 0)::numeric AS total_debit,
            COALESCE(SUM(le.credit), 0)::numeric AS total_credit
     FROM ledgers l
     JOIN ledger_entries le ON le.ledger_id = l.id
     WHERE l.type IN ('ASSET', 'LIABILITY')
       AND le.date BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR le.branch_id = $3 OR le.branch_id IS NULL)
     GROUP BY l.id, l.name, l.type
     ORDER BY l.type, l.name`,
    [start, end, branchId]
  );
  const assets = [];
  const liabilities = [];
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const row of res.rows) {
    const debit = Number(row.total_debit || 0);
    const credit = Number(row.total_credit || 0);
    const net = row.type === 'ASSET' ? debit - credit : credit - debit;
    if (row.type === 'ASSET') {
      totalAssets += net;
      assets.push({ ...row, net_amount: net });
    } else {
      totalLiabilities += net;
      liabilities.push({ ...row, net_amount: net });
    }
  }
  return { assets, liabilities, summary: { total_assets: totalAssets, total_liabilities: totalLiabilities } };
};

const getLedgerGstSummary = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const { range, start_date: startDateRaw, end_date: endDateRaw } = query || {};
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = resolveBranchIdFromRequest(req);
  const res = await requestPool.query(
    `SELECT l.name,
            COALESCE(SUM(le.debit), 0)::numeric AS total_debit,
            COALESCE(SUM(le.credit), 0)::numeric AS total_credit
     FROM ledgers l
     JOIN ledger_entries le ON le.ledger_id = l.id
     WHERE l.name IN ('Output CGST', 'Output SGST', 'Output IGST', 'Input CGST', 'Input SGST', 'Input IGST')
       AND le.date BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR le.branch_id = $3 OR le.branch_id IS NULL)
     GROUP BY l.name
     ORDER BY l.name`,
    [start, end, branchId]
  );
  return { rows: res.rows };
};

const getReceiptEntries = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const { range, start_date: startDateRaw, end_date: endDateRaw, page, limit } = query || {};
  const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
  const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const offset = (resolvedPage - 1) * resolvedLimit;
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = resolveBranchIdFromRequest(req);
  const params = [start, end, branchId, resolvedLimit, offset];

  const rowsRes = await requestPool.query(
    `SELECT t.id,
            t.created_at,
            COALESCE(t.amount, t.total_price, 0)::numeric AS amount,
            t.payment_mode,
            t.txn_type,
            t.notes,
            t.party_id,
            c.name AS party_name
     FROM transactions t
     LEFT JOIN orders o ON o.id = t.order_id
     LEFT JOIN customers c ON c.id = t.party_id
     WHERE t.created_at BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $3)
       AND t.party_type = 'customer'
       AND LOWER(COALESCE(t.direction, 'in')) = 'in'
       AND LOWER(COALESCE(t.txn_type, '')) IN ('sale', 'receipt')
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $4 OFFSET $5`,
    params
  );

  const countRes = await requestPool.query(
    `SELECT COUNT(*)::int AS total
     FROM transactions t
     LEFT JOIN orders o ON o.id = t.order_id
     WHERE t.created_at BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $3)
       AND t.party_type = 'customer'
       AND LOWER(COALESCE(t.direction, 'in')) = 'in'
       AND LOWER(COALESCE(t.txn_type, '')) IN ('sale', 'receipt')`,
    [start, end, branchId]
  );

  return { entries: rowsRes.rows, page: resolvedPage, limit: resolvedLimit, total: countRes.rows[0]?.total || 0 };
};

const getPaymentEntries = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const { range, start_date: startDateRaw, end_date: endDateRaw, page, limit } = query || {};
  const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
  const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const offset = (resolvedPage - 1) * resolvedLimit;
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const branchId = resolveBranchIdFromRequest(req);
  const params = [start, end, branchId, resolvedLimit, offset];

  const rowsRes = await requestPool.query(
    `SELECT t.id,
            t.created_at,
            COALESCE(t.amount, t.total_price, 0)::numeric AS amount,
            t.payment_mode,
            t.txn_type,
            t.notes,
            t.party_type,
            t.party_id,
            CASE
              WHEN t.party_type = 'supplier' THEN s.name
              ELSE NULL
            END AS party_name
     FROM transactions t
     LEFT JOIN orders o ON o.id = t.order_id
     LEFT JOIN suppliers s ON s.id = t.party_id
     WHERE t.created_at BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $3)
       AND LOWER(COALESCE(t.direction, 'out')) = 'out'
       AND (
         (t.party_type = 'supplier' AND LOWER(COALESCE(t.txn_type, '')) = 'payment')
         OR (t.party_type = 'expense' AND LOWER(COALESCE(t.txn_type, '')) = 'payment')
       )
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $4 OFFSET $5`,
    params
  );

  const countRes = await requestPool.query(
    `SELECT COUNT(*)::int AS total
     FROM transactions t
     LEFT JOIN orders o ON o.id = t.order_id
     WHERE t.created_at BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $3)
       AND LOWER(COALESCE(t.direction, 'out')) = 'out'
       AND (
         (t.party_type = 'supplier' AND LOWER(COALESCE(t.txn_type, '')) = 'payment')
         OR (t.party_type = 'expense' AND LOWER(COALESCE(t.txn_type, '')) = 'payment')
       )`,
    [start, end, branchId]
  );

  return { entries: rowsRes.rows, page: resolvedPage, limit: resolvedLimit, total: countRes.rows[0]?.total || 0 };
};

const computeOpeningInventory = async (client, branchId = null) => {
  const invRes = await client.query(
    `SELECT COALESCE(SUM(COALESCE(stock_quantity, 0) * COALESCE(purchase_price, 0)), 0)::numeric AS inventory_value,
            COUNT(*)::int AS imported_products_count
     FROM products
     WHERE is_deleted = FALSE
       AND ($1::uuid IS NULL OR branch_id = $1)`,
    [branchId]
  );
  return {
    inventoryValue: Number(invRes.rows[0]?.inventory_value || 0),
    importedProductsCount: Number(invRes.rows[0]?.imported_products_count || 0),
  };
};

const getOpeningSetupSummary = async (req) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req);
  const [stateRes, summaryRes] = await Promise.all([
    requestPool.query(
      'SELECT COALESCE(is_opening_completed, FALSE) AS is_opening_completed FROM settings ORDER BY id ASC LIMIT 1'
    ),
    requestPool.query(
      `SELECT COUNT(*)::int AS total_products,
              COALESCE(SUM(COALESCE(stock_quantity, 0)), 0)::numeric AS total_quantity,
              COALESCE(SUM(COALESCE(stock_quantity, 0) * COALESCE(purchase_price, 0)), 0)::numeric AS inventory_value
       FROM products
       WHERE is_deleted = FALSE
         AND ($1::uuid IS NULL OR branch_id = $1)`,
      [branchId]
    ),
  ]);

  return {
    is_opening_completed: Boolean(stateRes.rows[0]?.is_opening_completed),
    total_products: Number(summaryRes.rows[0]?.total_products || 0),
    total_quantity: Number(summaryRes.rows[0]?.total_quantity || 0),
    inventory_value: Number(summaryRes.rows[0]?.inventory_value || 0),
  };
};

const saveOpeningSetup = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const client = await requestPool.connect();
  try {
    const cashAmount = Number(payload.cash_amount ?? payload.cashAmount ?? 0);
    const bankAmount = Number(payload.bank_amount ?? payload.bankAmount ?? 0);
    if (!Number.isFinite(cashAmount) || cashAmount < 0) throw buildValidationError('cash_amount must be >= 0.');
    if (!Number.isFinite(bankAmount) || bankAmount < 0) throw buildValidationError('bank_amount must be >= 0.');
    const branchId = resolveBranchIdFromRequest(req);

    await client.query('BEGIN');
    const stateRes = await client.query('SELECT COALESCE(is_opening_completed, FALSE) AS is_opening_completed FROM settings ORDER BY id ASC LIMIT 1 FOR UPDATE');
    if (Boolean(stateRes.rows[0]?.is_opening_completed)) throw buildValidationError('Opening already completed.');

    const { inventoryValue, importedProductsCount } = await computeOpeningInventory(client, branchId);
    const totalCapital = Number((inventoryValue + cashAmount + bankAmount).toFixed(2));
    await client.query(
      `INSERT INTO opening_setup (id, cash_amount, bank_amount, inventory_value, total_capital, updated_at)
       VALUES (1, $1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE
       SET cash_amount = EXCLUDED.cash_amount,
           bank_amount = EXCLUDED.bank_amount,
           inventory_value = EXCLUDED.inventory_value,
           total_capital = EXCLUDED.total_capital,
           updated_at = NOW()`,
      [cashAmount, bankAmount, inventoryValue, totalCapital]
    );
    await client.query('COMMIT');
    return { imported_products_count: importedProductsCount, inventory_value: inventoryValue, cash_amount: cashAmount, bank_amount: bankAmount, total_capital: totalCapital };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const finalizeOpening = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const client = await requestPool.connect();
  try {
    const branchId = resolveBranchIdFromRequest(req);
    await client.query('BEGIN');
    const stateRes = await client.query('SELECT COALESCE(is_opening_completed, FALSE) AS is_opening_completed FROM settings ORDER BY id ASC LIMIT 1 FOR UPDATE');
    if (Boolean(stateRes.rows[0]?.is_opening_completed)) throw buildValidationError('Opening already completed.');
    const duplicateRes = await client.query(`SELECT 1 FROM ledger_entries WHERE reference_type = 'opening' LIMIT 1`);
    if (duplicateRes.rowCount > 0) throw buildValidationError('Opening entry already exists.');

    const setupRes = await client.query('SELECT cash_amount, bank_amount FROM opening_setup WHERE id = 1 LIMIT 1');
    if (setupRes.rowCount === 0) throw buildValidationError('Opening setup is not saved. Please complete opening setup first.');
    const cashAmount = Number(setupRes.rows[0]?.cash_amount || 0);
    const bankAmount = Number(setupRes.rows[0]?.bank_amount || 0);
    if (!Number.isFinite(cashAmount) || cashAmount < 0) throw buildValidationError('cash_amount must be >= 0.');
    if (!Number.isFinite(bankAmount) || bankAmount < 0) throw buildValidationError('bank_amount must be >= 0.');

    const { inventoryValue } = await computeOpeningInventory(client, branchId);
    const mismatchRes = await client.query(
      `WITH batch_totals AS (
         SELECT product_id, COALESCE(SUM(COALESCE(quantity_remaining, quantity)), 0)::numeric AS qty
         FROM batches
         WHERE is_deleted = FALSE
         GROUP BY product_id
       )
       SELECT COUNT(*)::int AS mismatches
       FROM products p
       LEFT JOIN batch_totals bt ON bt.product_id = p.id
       WHERE p.is_deleted = FALSE
         AND p.is_batch_enabled = TRUE
         AND COALESCE(p.stock_quantity, 0)::numeric <> COALESCE(bt.qty, 0)::numeric`
    );
    if (Number(mismatchRes.rows[0]?.mismatches || 0) > 0) {
      throw buildValidationError('Inventory and batch stock mismatch detected. Resolve stock consistency before finalizing opening.');
    }
    const totalCapital = Number((inventoryValue + cashAmount + bankAmount).toFixed(2));

    const lines = [
      { ledger: 'Inventory', debit: inventoryValue, credit: 0 },
      { ledger: 'Cash in Hand', debit: cashAmount, credit: 0 },
      { ledger: 'Bank Account', debit: bankAmount, credit: 0 },
      { ledger: 'Capital', debit: 0, credit: totalCapital },
    ].filter((line) => Number(line.debit || line.credit) > 0);

    const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    if (Math.round(debit * 100) !== Math.round(credit * 100)) {
      throw buildValidationError('Opening posting failed: debit and credit do not match.');
    }

    const clientTxnId = payload.client_txn_id || crypto.randomUUID();
    await insertLedgerEntries({
      client,
      lines,
      referenceId: null,
      referenceType: 'opening',
      description: 'Opening balance setup',
      date: payload.date || null,
      branchId,
      clientTxnId,
      syncStatus: 'SYNCED',
      partyType: 'expense',
      partyId: null,
    });

    await client.query(
      `UPDATE settings
       SET is_opening_completed = TRUE,
           opening_completed_at = NOW()`
    );
    await client.query(
      `INSERT INTO opening_setup (id, cash_amount, bank_amount, inventory_value, total_capital, updated_at)
       VALUES (1, $1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE
       SET cash_amount = EXCLUDED.cash_amount,
           bank_amount = EXCLUDED.bank_amount,
           inventory_value = EXCLUDED.inventory_value,
           total_capital = EXCLUDED.total_capital,
           updated_at = NOW()`,
      [cashAmount, bankAmount, inventoryValue, totalCapital]
    );

    await client.query('COMMIT');
    return { inventory_value: inventoryValue, cash_amount: cashAmount, bank_amount: bankAmount, total_capital: totalCapital, is_opening_completed: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const toMoney = (value) => Number(Number(value || 0).toFixed(2));
const makeStatus = (difference) => (Math.abs(toMoney(difference)) <= 0.009 ? 'PASS' : 'FAIL');

const getReconciliation = async (req) => {
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req);

  const [inventoryRes, inventoryLedgerRes, supplierLedgerRes, supplierUiRes, customerLedgerRes, customerUiRes, cashLedgerRes, bankLedgerRes, cashUiRes, bankUiRes, totalsRes] = await Promise.all([
    requestPool.query(
      `SELECT COALESCE(SUM(COALESCE(stock_quantity, 0) * COALESCE(purchase_price, 0)), 0)::numeric AS expected_value
       FROM products
       WHERE is_deleted = FALSE
         AND ($1::uuid IS NULL OR branch_id = $1)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(le.debit - le.credit), 0)::numeric AS actual_value
       FROM ledger_entries le
       JOIN ledgers l ON l.id = le.ledger_id
       WHERE LOWER(l.name) = LOWER('Inventory')
         AND ($1::uuid IS NULL OR le.branch_id = $1 OR le.branch_id IS NULL)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(le.credit - le.debit), 0)::numeric AS actual_value
       FROM ledger_entries le
       JOIN ledgers l ON l.id = le.ledger_id
       WHERE LOWER(l.name) = LOWER('Accounts Payable')
         AND ($1::uuid IS NULL OR le.branch_id = $1 OR le.branch_id IS NULL)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(COALESCE(s.current_balance, 0)), 0)::numeric AS expected_value
       FROM suppliers s
       WHERE COALESCE(s.is_deleted, FALSE) = FALSE
         AND ($1::uuid IS NULL OR s.branch_id = $1)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(le.debit - le.credit), 0)::numeric AS actual_value
       FROM ledger_entries le
       JOIN ledgers l ON l.id = le.ledger_id
       WHERE LOWER(l.name) = LOWER('Accounts Receivable')
         AND ($1::uuid IS NULL OR le.branch_id = $1 OR le.branch_id IS NULL)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(COALESCE(c.current_balance, 0)), 0)::numeric AS expected_value
       FROM customers c
       WHERE COALESCE(c.is_active, TRUE) = TRUE
         AND ($1::uuid IS NULL OR c.branch_id = $1)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(le.debit - le.credit), 0)::numeric AS actual_value
       FROM ledger_entries le
       JOIN ledgers l ON l.id = le.ledger_id
       WHERE LOWER(l.name) = LOWER('Cash in Hand')
         AND ($1::uuid IS NULL OR le.branch_id = $1 OR le.branch_id IS NULL)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(le.debit - le.credit), 0)::numeric AS actual_value
       FROM ledger_entries le
       JOIN ledgers l ON l.id = le.ledger_id
       WHERE LOWER(l.name) = LOWER('Bank Account')
         AND ($1::uuid IS NULL OR le.branch_id = $1 OR le.branch_id IS NULL)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(
                CASE
                  WHEN LOWER(COALESCE(t.direction, 'in')) = 'in' THEN COALESCE(t.amount, t.total_price, 0)
                  WHEN LOWER(COALESCE(t.direction, 'out')) = 'out' THEN -COALESCE(t.amount, t.total_price, 0)
                  ELSE 0
                END
              ), 0)::numeric AS expected_value
       FROM transactions t
       LEFT JOIN orders o ON o.id = t.order_id
       WHERE LOWER(COALESCE(t.payment_mode, 'cash')) = 'cash'
         AND ($1::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $1)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT COALESCE(SUM(
                CASE
                  WHEN LOWER(COALESCE(t.direction, 'in')) = 'in' THEN COALESCE(t.amount, t.total_price, 0)
                  WHEN LOWER(COALESCE(t.direction, 'out')) = 'out' THEN -COALESCE(t.amount, t.total_price, 0)
                  ELSE 0
                END
              ), 0)::numeric AS expected_value
       FROM transactions t
       LEFT JOIN orders o ON o.id = t.order_id
       WHERE LOWER(COALESCE(t.payment_mode, 'cash')) IN ('bank', 'online', 'upi')
         AND ($1::uuid IS NULL OR COALESCE(t.branch_id, o.branch_id) = $1)`,
      [branchId]
    ),
    requestPool.query(
      `SELECT
          COALESCE(SUM(le.debit), 0)::numeric AS total_debit,
          COALESCE(SUM(le.credit), 0)::numeric AS total_credit
       FROM ledger_entries le
       WHERE ($1::uuid IS NULL OR le.branch_id = $1 OR le.branch_id IS NULL)`,
      [branchId]
    ),
  ]);

  const inventoryExpected = toMoney(inventoryRes.rows[0]?.expected_value);
  const inventoryActual = toMoney(inventoryLedgerRes.rows[0]?.actual_value);
  const inventoryDiff = toMoney(inventoryExpected - inventoryActual);

  const supplierExpected = toMoney(supplierUiRes.rows[0]?.expected_value);
  const supplierActual = toMoney(supplierLedgerRes.rows[0]?.actual_value);
  const supplierDiff = toMoney(supplierExpected - supplierActual);

  const customerExpected = toMoney(customerUiRes.rows[0]?.expected_value);
  const customerActual = toMoney(customerLedgerRes.rows[0]?.actual_value);
  const customerDiff = toMoney(customerExpected - customerActual);

  const cashExpected = toMoney(cashUiRes.rows[0]?.expected_value);
  const cashActual = toMoney(cashLedgerRes.rows[0]?.actual_value);
  const cashDiff = toMoney(cashExpected - cashActual);

  const bankExpected = toMoney(bankUiRes.rows[0]?.expected_value);
  const bankActual = toMoney(bankLedgerRes.rows[0]?.actual_value);
  const bankDiff = toMoney(bankExpected - bankActual);

  const totalDebit = toMoney(totalsRes.rows[0]?.total_debit);
  const totalCredit = toMoney(totalsRes.rows[0]?.total_credit);
  const ledgerDiff = toMoney(totalDebit - totalCredit);

  return {
    inventory: {
      status: makeStatus(inventoryDiff),
      expected_value: inventoryExpected,
      actual_value: inventoryActual,
      difference: inventoryDiff,
    },
    supplier: {
      status: makeStatus(supplierDiff),
      expected_value: supplierExpected,
      actual_value: supplierActual,
      difference: supplierDiff,
    },
    customer: {
      status: makeStatus(customerDiff),
      expected_value: customerExpected,
      actual_value: customerActual,
      difference: customerDiff,
    },
    cash: {
      status: makeStatus(cashDiff),
      expected_value: cashExpected,
      actual_value: cashActual,
      difference: cashDiff,
      balance: cashActual,
    },
    bank: {
      status: makeStatus(bankDiff),
      expected_value: bankExpected,
      actual_value: bankActual,
      difference: bankDiff,
      balance: bankActual,
    },
    ledger_balance: {
      status: makeStatus(ledgerDiff),
      total_debit: totalDebit,
      total_credit: totalCredit,
      difference: ledgerDiff,
    },
  };
};

module.exports = {
  createReceipt,
  createPayment,
  getCashBook,
  getBankBook,
  getLedger,
  getOutstanding,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getLedgerGstSummary,
  getReceiptEntries,
  getPaymentEntries,
  saveOpeningSetup,
  getOpeningSetupSummary,
  finalizeOpening,
  getReconciliation,
};
