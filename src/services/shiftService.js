const pool = require('../db');

const DENOMINATION_VALUES = {
  '2000': 2000,
  '500': 500,
  '200': 200,
  '100': 100,
  '50': 50,
  '20': 20,
  '10': 10,
  '5': 5,
};

const calculateDenominationsTotal = (denominations = {}) => {
  if (!denominations || typeof denominations !== 'object') return 0;
  let total = 0;
  for (const [key, count] of Object.entries(denominations)) {
    if (key === 'coins' || key === 'others') {
      total += Math.max(0, Number(count) || 0);
    } else if (DENOMINATION_VALUES[key]) {
      const multiplier = DENOMINATION_VALUES[key];
      const qty = Math.max(0, Number(count) || 0);
      total += multiplier * qty;
    }
  }
  return Math.round(total * 100) / 100;
};

const calculateExpectedCash = async (client, { branchId, shiftStart, openingCash = 0 }) => {
  const start = shiftStart ? new Date(shiftStart) : new Date();

  // 1. Cash Sales from transactions
  let cashSales = 0;
  try {
    const salesRes = await client.query(
      `SELECT COALESCE(SUM(total_price), 0)::numeric AS cash_sales
       FROM transactions
       WHERE payment_mode = 'cash'
         AND created_at >= $1
         AND ($2::uuid IS NULL OR branch_id = $2)`,
      [start, branchId || null]
    );
    cashSales = Number(salesRes.rows[0]?.cash_sales || 0);
  } catch {
    // If transactions table doesn't have branch_id, query orders
    try {
      const ordersRes = await client.query(
        `SELECT COALESCE(SUM(total_price), 0)::numeric AS cash_sales
         FROM orders
         WHERE payment_mode = 'cash'
           AND created_at >= $1
           AND ($2::uuid IS NULL OR branch_id = $2)`,
        [start, branchId || null]
      );
      cashSales = Number(ordersRes.rows[0]?.cash_sales || 0);
    } catch {
      cashSales = 0;
    }
  }

  // 2. Cash Receipts from accounts / customers
  let cashReceipts = 0;
  try {
    const receiptsRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS cash_receipts
       FROM customer_payments
       WHERE payment_mode = 'cash'
         AND created_at >= $1`,
      [start]
    );
    cashReceipts = Number(receiptsRes.rows[0]?.cash_receipts || 0);
  } catch {
    cashReceipts = 0;
  }

  // 3. Cash Expenses / Payouts
  let cashExpenses = 0;
  try {
    const expRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS cash_expenses
       FROM expenses
       WHERE payment_mode = 'cash'
         AND created_at >= $1
         AND ($2::uuid IS NULL OR branch_id = $2)`,
      [start, branchId || null]
    );
    cashExpenses = Number(expRes.rows[0]?.cash_expenses || 0);
  } catch {
    cashExpenses = 0;
  }

  const expected = Number(openingCash || 0) + cashSales + cashReceipts - cashExpenses;
  return {
    openingCash: Number(openingCash || 0),
    cashSales,
    cashReceipts,
    cashExpenses,
    expectedCash: Math.round(expected * 100) / 100,
  };
};

const getCurrentShift = async ({ tenantPool, branchId, userId }) => {
  const client = tenantPool || pool;
  const res = await client.query(
    `SELECT *
     FROM cashier_shifts
     WHERE status = 'OPEN'
       AND ($1::uuid IS NULL OR branch_id = $1)
       AND ($2::int IS NULL OR user_id = $2)
     ORDER BY shift_start DESC
     LIMIT 1`,
    [branchId || null, userId || null]
  );

  if (!res.rows.length) return null;

  const shift = res.rows[0];
  const cashBreakdown = await calculateExpectedCash(client, {
    branchId: shift.branch_id,
    shiftStart: shift.shift_start,
    openingCash: shift.opening_cash,
  });

  return {
    ...shift,
    cash_breakdown: cashBreakdown,
    expected_cash: cashBreakdown.expectedCash,
  };
};

const openShift = async ({ tenantPool, branchId, userId, cashierName, terminalId, openingCash = 0, notes = '' }) => {
  const client = tenantPool || pool;

  // Check if open shift already exists
  const existing = await getCurrentShift({ tenantPool, branchId, userId });
  if (existing) {
    return existing;
  }

  const res = await client.query(
    `INSERT INTO cashier_shifts (branch_id, user_id, cashier_name, terminal_id, opening_cash, expected_cash, status, notes)
     VALUES ($1, $2, $3, $4, $5, $5, 'OPEN', $6)
     RETURNING *`,
    [
      branchId || null,
      userId || null,
      cashierName || 'Cashier',
      terminalId || 'POS-1',
      Number(openingCash || 0),
      notes || null,
    ]
  );

  return res.rows[0];
};

const declareAndCloseShift = async ({ tenantPool, shiftId, branchId, userId, declaredCash, denominations = {}, notes = '' }) => {
  const client = tenantPool || pool;

  let shift = null;
  if (shiftId) {
    const shiftRes = await client.query(`SELECT * FROM cashier_shifts WHERE id = $1`, [shiftId]);
    shift = shiftRes.rows[0];
  } else {
    shift = await getCurrentShift({ tenantPool, branchId, userId });
  }

  if (!shift) {
    throw new Error('NO_ACTIVE_SHIFT');
  }

  const denomTotal = calculateDenominationsTotal(denominations);
  const finalDeclared = declaredCash !== undefined ? Number(declaredCash || 0) : denomTotal;

  const cashBreakdown = await calculateExpectedCash(client, {
    branchId: shift.branch_id,
    shiftStart: shift.shift_start,
    openingCash: shift.opening_cash,
  });

  const expectedCash = cashBreakdown.expectedCash;
  const variance = Math.round((finalDeclared - expectedCash) * 100) / 100;

  const res = await client.query(
    `UPDATE cashier_shifts
     SET shift_end = (NOW() AT TIME ZONE 'UTC'),
         expected_cash = $1,
         declared_cash = $2,
         variance = $3,
         denominations = $4,
         status = 'CLOSED',
         notes = COALESCE($5, notes)
     WHERE id = $6
     RETURNING *`,
    [
      expectedCash,
      finalDeclared,
      variance,
      JSON.stringify(denominations || {}),
      notes || null,
      shift.id,
    ]
  );

  return {
    ...res.rows[0],
    cash_breakdown: cashBreakdown,
  };
};

const listShifts = async ({ tenantPool, branchId, limit = 50, offset = 0, from, to }) => {
  const client = tenantPool || pool;
  const res = await client.query(
    `SELECT *
     FROM cashier_shifts
     WHERE ($1::uuid IS NULL OR branch_id = $1)
       AND ($2::date IS NULL OR shift_start >= $2)
       AND ($3::date IS NULL OR shift_start <= $3)
     ORDER BY shift_start DESC
     LIMIT $4 OFFSET $5`,
    [branchId || null, from || null, to || null, limit, offset]
  );

  return res.rows;
};

module.exports = {
  calculateDenominationsTotal,
  calculateExpectedCash,
  getCurrentShift,
  openShift,
  declareAndCloseShift,
  listShifts,
};
