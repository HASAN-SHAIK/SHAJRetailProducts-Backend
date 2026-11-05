const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/postgres';

const defaultDbPool = require('../src/db');
const accountingService = require('../src/services/accountingService');

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('V1 Stage 2 Accounting PostgreSQL Acceptance Integration Suite', () => {
  let pool;
  const branchId = '11111111-1111-4111-8111-111111111111';

  const mockReq = (userRole = 'cashier') => ({
    tenantPool: pool,
    user: {
      id: 1,
      name: 'Test Cashier',
      role: userRole,
      branch_id: branchId,
      all_branch_access: false,
      type: 'tenant',
    },
    headers: {},
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });

    // Clean previous test state and seed test fixtures statement-by-statement
    await pool.query('TRUNCATE TABLE transactions, ledger_entries, customer_payments, order_items, orders RESTART IDENTITY CASCADE;');
    await pool.query('DELETE FROM customers WHERE id > 1;');
    await pool.query('DELETE FROM suppliers WHERE id > 1;');

    await pool.query(`
      INSERT INTO branches (id, name, location)
      VALUES ($1, 'Main Branch', 'Test Location')
      ON CONFLICT (id) DO NOTHING
    `, [branchId]);

    await pool.query(`
      INSERT INTO customers (id, name, current_balance)
      VALUES (1, 'Test Customer', 0)
      ON CONFLICT (id) DO UPDATE SET current_balance = 0;
    `);
    await pool.query(`SELECT setval(pg_get_serial_sequence('customers', 'id'), 1, true);`);

    await pool.query(`
      INSERT INTO suppliers (id, name, mobile)
      VALUES (1, 'Test Supplier', '9876543211')
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`SELECT setval(pg_get_serial_sequence('suppliers', 'id'), 1, true);`);

    // System ledgers are pre-seeded by tenant_schema.sql. Ensure any missing are present:
    await pool.query(`
      INSERT INTO ledgers (name, type, is_system, branch_id)
      VALUES
        ('Cash in Hand', 'ASSET', TRUE, NULL),
        ('Bank Account', 'ASSET', TRUE, NULL),
        ('Accounts Receivable', 'ASSET', TRUE, NULL),
        ('Accounts Payable', 'LIABILITY', TRUE, NULL),
        ('Drawings Account', 'EXPENSE', TRUE, NULL),
        ('Rent', 'EXPENSE', TRUE, NULL),
        ('Salaries', 'EXPENSE', TRUE, NULL),
        ('Misc Expense', 'EXPENSE', TRUE, NULL)
      ON CONFLICT DO NOTHING;
    `);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (defaultDbPool && defaultDbPool.end) {
      try { await defaultDbPool.end(); } catch (e) {}
    }
  });

  test('1. Customer receipts against sales orders update total_paid via trigger and transition status', async () => {
    // Create sales order for 1000
    const orderRes = await pool.query(`
      INSERT INTO orders (customer_id, total_price, total_paid, returned_amount, order_status, branch_id, transaction_type)
      VALUES (1, 1000, 0, 0, 'pending', $1, 'sale')
      RETURNING id
    `, [branchId]);
    const orderId = orderRes.rows[0].id;

    const clientTxnId1 = crypto.randomUUID();
    const receipt1 = await accountingService.createReceipt(mockReq('cashier'), {
      customer_id: 1,
      amount: 400,
      payment_mode: 'cash',
      order_id: orderId,
      client_txn_id: clientTxnId1,
    });
    expect(receipt1.id).toBeDefined();

    // Verify trigger updated orders.total_paid to 400 and status remains pending
    const check1 = await pool.query('SELECT total_paid, order_status FROM orders WHERE id = $1', [orderId]);
    expect(Number(check1.rows[0].total_paid)).toBe(400);
    expect(check1.rows[0].order_status).toBe('pending');

    // Second payment for remaining 600
    const clientTxnId2 = crypto.randomUUID();
    const receipt2 = await accountingService.createReceipt(mockReq('cashier'), {
      customer_id: 1,
      amount: 600,
      payment_mode: 'online',
      order_id: orderId,
      client_txn_id: clientTxnId2,
    });
    expect(receipt2.id).toBeDefined();

    // Verify trigger updated total_paid to 1000 and status transitioned to completed
    const check2 = await pool.query('SELECT total_paid, order_status FROM orders WHERE id = $1', [orderId]);
    expect(Number(check2.rows[0].total_paid)).toBe(1000);
    expect(check2.rows[0].order_status).toBe('completed');

    // Customer payments table was not touched for order receipts (preventing double decrement)
    const cpCount = await pool.query('SELECT COUNT(*)::int AS count FROM customer_payments WHERE customer_id = 1');
    expect(cpCount.rows[0].count).toBe(0);
  });

  test('2. On-account customer receipts insert customer_payments and trigger outstanding reduction', async () => {
    const clientTxnId = crypto.randomUUID();
    const receipt = await accountingService.createReceipt(mockReq('cashier'), {
      customer_id: 1,
      amount: 250,
      payment_mode: 'bank',
      notes: 'Advance deposit',
      client_txn_id: clientTxnId,
    });
    expect(receipt.id).toBeDefined();
    expect(receipt.order_id).toBeNull();

    // Verify row inserted in customer_payments
    const cpRes = await pool.query('SELECT amount, payment_mode, notes FROM customer_payments WHERE customer_id = 1');
    expect(cpRes.rowCount).toBe(1);
    expect(Number(cpRes.rows[0].amount)).toBe(250);
    expect(cpRes.rows[0].payment_mode).toBe('bank');

    // Verify ledger lines
    const ledgerLines = await pool.query(`
      SELECT l.name, le.debit, le.credit
      FROM ledger_entries le
      JOIN ledgers l ON l.id = le.ledger_id
      WHERE le.client_txn_id = $1
      ORDER BY le.line_no ASC
    `, [clientTxnId]);
    expect(ledgerLines.rows).toHaveLength(2);
    expect(ledgerLines.rows[0].name).toBe('Bank Account');
    expect(Number(ledgerLines.rows[0].debit)).toBe(250);
    expect(ledgerLines.rows[1].name).toBe('Accounts Receivable');
    expect(Number(ledgerLines.rows[1].credit)).toBe(250);
  });

  test('3. Supplier payments against purchase orders update total_paid and complete order', async () => {
    const purchaseRes = await pool.query(`
      INSERT INTO orders (supplier_id, total_price, total_paid, returned_amount, order_status, branch_id, transaction_type)
      VALUES (1, 800, 0, 0, 'pending', $1, 'purchase')
      RETURNING id
    `, [branchId]);
    const purchaseOrderId = purchaseRes.rows[0].id;

    const clientTxnId = crypto.randomUUID();
    const payment = await accountingService.createPayment(mockReq('manager'), {
      type: 'supplier',
      supplier_id: 1,
      amount: 800,
      payment_mode: 'bank',
      order_id: purchaseOrderId,
      client_txn_id: clientTxnId,
    });
    expect(payment.id).toBeDefined();

    // Verify trigger updated purchase order total_paid to 800 and status to completed
    const check = await pool.query('SELECT total_paid, order_status FROM orders WHERE id = $1', [purchaseOrderId]);
    expect(Number(check.rows[0].total_paid)).toBe(800);
    expect(check.rows[0].order_status).toBe('completed');

    // Verify ledger lines: Accounts Payable Dr 800, Bank Account Cr 800
    const ledgerLines = await pool.query(`
      SELECT l.name, le.debit, le.credit
      FROM ledger_entries le
      JOIN ledgers l ON l.id = le.ledger_id
      WHERE le.client_txn_id = $1
      ORDER BY le.line_no ASC
    `, [clientTxnId]);
    expect(ledgerLines.rows).toHaveLength(2);
    expect(ledgerLines.rows[0].name).toBe('Accounts Payable');
    expect(Number(ledgerLines.rows[0].debit)).toBe(800);
    expect(ledgerLines.rows[1].name).toBe('Bank Account');
    expect(Number(ledgerLines.rows[1].credit)).toBe(800);
  });

  test('4. On-account supplier payments have NULL order_id and affect no orders', async () => {
    const clientTxnId = crypto.randomUUID();
    const payment = await accountingService.createPayment(mockReq('manager'), {
      type: 'supplier',
      supplier_id: 1,
      amount: 350,
      payment_mode: 'cash',
      client_txn_id: clientTxnId,
    });
    expect(payment.id).toBeDefined();
    expect(payment.order_id).toBeNull();

    const txnRes = await pool.query('SELECT order_id, txn_type, direction FROM transactions WHERE client_txn_id = $1', [clientTxnId]);
    expect(txnRes.rows[0].order_id).toBeNull();
    expect(txnRes.rows[0].txn_type).toBe('payment');
    expect(txnRes.rows[0].direction).toBe('out');
  });

  test('5. Expense and drawings payments post correctly and reject order_id', async () => {
    const clientTxnIdExpense = crypto.randomUUID();
    const expensePayment = await accountingService.createPayment(mockReq('manager'), {
      type: 'expense',
      expense_category: 'Rent',
      amount: 500,
      payment_mode: 'bank',
      client_txn_id: clientTxnIdExpense,
    });
    expect(expensePayment.id).toBeDefined();

    const expenseLedger = await pool.query(`
      SELECT l.name, le.debit, le.credit
      FROM ledger_entries le
      JOIN ledgers l ON l.id = le.ledger_id
      WHERE le.client_txn_id = $1
      ORDER BY le.line_no ASC
    `, [clientTxnIdExpense]);
    expect(expenseLedger.rows[0].name).toBe('Rent');
    expect(Number(expenseLedger.rows[0].debit)).toBe(500);
    expect(expenseLedger.rows[1].name).toBe('Bank Account');
    expect(Number(expenseLedger.rows[1].credit)).toBe(500);

    // Drawings payment
    const clientTxnIdDrawings = crypto.randomUUID();
    const drawingsPayment = await accountingService.createPayment(mockReq('manager'), {
      type: 'drawings',
      amount: 200,
      payment_mode: 'cash',
      client_txn_id: clientTxnIdDrawings,
    });
    expect(drawingsPayment.id).toBeDefined();

    // Verify rejecting order_id on expense payment
    await expect(
      accountingService.createPayment(mockReq('manager'), {
        type: 'expense',
        amount: 100,
        payment_mode: 'cash',
        order_id: 999,
        client_txn_id: crypto.randomUUID(),
      })
    ).rejects.toThrow('order_id is not allowed for expense or drawings payment.');
  });

  test('6. Outstanding balance recalculation accurately aggregates orders and payments', async () => {
    const custRes = await pool.query(`INSERT INTO customers (name, current_balance) VALUES ('Balance Test Cust', 0) RETURNING id`);
    const custId = custRes.rows[0].id;

    // Order 1: 500 (unpaid)
    await pool.query(`INSERT INTO orders (customer_id, total_price, total_paid, returned_amount, order_status, is_deleted) VALUES ($1, 500, 0, 0, 'pending', FALSE)`, [custId]);
    let bal = await pool.query('SELECT current_balance FROM customers WHERE id = $1', [custId]);
    expect(Number(bal.rows[0].current_balance)).toBe(500);

    // Order 2: 300 (unpaid)
    await pool.query(`INSERT INTO orders (customer_id, total_price, total_paid, returned_amount, order_status, is_deleted) VALUES ($1, 300, 0, 0, 'pending', FALSE)`, [custId]);
    bal = await pool.query('SELECT current_balance FROM customers WHERE id = $1', [custId]);
    expect(Number(bal.rows[0].current_balance)).toBe(800);

    // Partial on-account payment of 350
    await pool.query(`INSERT INTO customer_payments (customer_id, amount, payment_mode) VALUES ($1, 350, 'cash')`, [custId]);
    bal = await pool.query('SELECT current_balance FROM customers WHERE id = $1', [custId]);
    expect(Number(bal.rows[0].current_balance)).toBe(450);
  });

  test('7. Ledger posting rollback leaves no transactions or payments on failure', async () => {
    const clientTxnId = crypto.randomUUID();
    await expect(
      accountingService.createReceipt(mockReq('cashier'), {
        customer_id: 999999, // non-existent customer
        amount: 100,
        payment_mode: 'cash',
        client_txn_id: clientTxnId,
      })
    ).rejects.toThrow('customer_id is invalid.');

    // Verify nothing persisted
    const txnCheck = await pool.query('SELECT COUNT(*)::int AS count FROM transactions WHERE client_txn_id = $1', [clientTxnId]);
    expect(txnCheck.rows[0].count).toBe(0);
  });

  test('8. Idempotent sequential retries return existing transaction without creating duplicates', async () => {
    const clientTxnId = crypto.randomUUID();
    const payload = {
      customer_id: 1,
      amount: 150,
      payment_mode: 'cash',
      client_txn_id: clientTxnId,
    };

    // First call
    const res1 = await accountingService.createReceipt(mockReq('cashier'), payload);
    expect(res1.id).toBeDefined();
    expect(res1.idempotent).toBeUndefined();

    // Replay with identical payload
    const res2 = await accountingService.createReceipt(mockReq('cashier'), payload);
    expect(res2.id).toBe(res1.id);
    expect(res2.idempotent).toBe(true);

    // Verify strictly 1 row in transactions table
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM transactions WHERE client_txn_id = $1', [clientTxnId]);
    expect(countRes.rows[0].count).toBe(1);
  });

  test('9. Mismatched payload returning 409 when client_txn_id is reused', async () => {
    const clientTxnId = crypto.randomUUID();
    const initialPayload = {
      customer_id: 1,
      amount: 120,
      payment_mode: 'cash',
      client_txn_id: clientTxnId,
    };
    await accountingService.createReceipt(mockReq('cashier'), initialPayload);

    // Reuse client_txn_id with different amount
    let error;
    try {
      await accountingService.createReceipt(mockReq('cashier'), {
        ...initialPayload,
        amount: 240, // different amount
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.status).toBe(409);
    expect(error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('10. Concurrent duplicate transaction requests resolve safely without duplicate entries', async () => {
    const clientTxnId = crypto.randomUUID();
    const payload = {
      customer_id: 1,
      amount: 75,
      payment_mode: 'cash',
      client_txn_id: clientTxnId,
    };

    // Fire 2 concurrent requests with identical payload
    const [res1, res2] = await Promise.all([
      accountingService.createReceipt(mockReq('cashier'), payload),
      accountingService.createReceipt(mockReq('cashier'), payload),
    ]);

    expect(res1.id).toBe(res2.id);
    const eitherIdempotent = res1.idempotent === true || res2.idempotent === true;
    expect(eitherIdempotent).toBe(true);

    // Verify exactly 1 row in transactions
    const txnRes = await pool.query('SELECT COUNT(*)::int AS count FROM transactions WHERE client_txn_id = $1', [clientTxnId]);
    expect(txnRes.rows[0].count).toBe(1);

    // Verify exactly 2 ledger entries (one debit, one credit)
    const ledgerRes = await pool.query('SELECT COUNT(*)::int AS count FROM ledger_entries WHERE client_txn_id = $1', [clientTxnId]);
    expect(ledgerRes.rows[0].count).toBe(2);
  });

  test('11. Concurrent requests with same client_txn_id but different payloads: one succeeds and one returns 409 conflict', async () => {
    const clientTxnId = crypto.randomUUID();
    const payloadA = {
      customer_id: 1,
      amount: 444.50,
      payment_mode: 'cash',
      client_txn_id: clientTxnId,
    };
    const payloadB = {
      customer_id: 1,
      amount: 777.25, // Mismatched amount
      payment_mode: 'cash',
      client_txn_id: clientTxnId,
    };

    // Fire 2 simultaneous requests with different payloads
    const results = await Promise.allSettled([
      accountingService.createReceipt(mockReq('cashier'), payloadA),
      accountingService.createReceipt(mockReq('cashier'), payloadB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed, and one must be rejected with 409 IDEMPOTENCY_CONFLICT
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    expect(rejected[0].reason.status).toBe(409);
    expect(rejected[0].reason.code).toBe('IDEMPOTENCY_CONFLICT');

    // Exactly one transaction persists
    const txnRes = await pool.query('SELECT COUNT(*)::int AS count FROM transactions WHERE client_txn_id = $1', [clientTxnId]);
    expect(txnRes.rows[0].count).toBe(1);

    // Exactly one set of ledger entries persists (1 debit, 1 credit)
    const ledgerRes = await pool.query('SELECT COUNT(*)::int AS count FROM ledger_entries WHERE client_txn_id = $1', [clientTxnId]);
    expect(ledgerRes.rows[0].count).toBe(2);

    // Exactly one customer payment record persists matching the winning transaction amount
    const txn = await pool.query('SELECT amount FROM transactions WHERE id = $1', [fulfilled[0].value.id]);
    const winningAmount = Number(txn.rows[0].amount);
    expect([444.50, 777.25]).toContain(winningAmount);

    const cpRes = await pool.query('SELECT COUNT(*)::int AS count FROM customer_payments WHERE customer_id = 1 AND amount = $1', [winningAmount]);
    expect(cpRes.rows[0].count).toBe(1);

    // No orphan or duplicate customer_payments exist for either amount
    const totalCpRes = await pool.query('SELECT COUNT(*)::int AS count FROM customer_payments WHERE customer_id = 1 AND amount IN (444.50, 777.25)');
    expect(totalCpRes.rows[0].count).toBe(1);
  });
});

