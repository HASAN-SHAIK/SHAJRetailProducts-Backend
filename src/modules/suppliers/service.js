const normalizePhone = (value) => {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  return digits || null;
};

const buildSupplierInput = (payload = {}) => {
  const phone = normalizePhone(payload.mobile || payload.phone);
  return {
    name: payload.name || null,
    mobile: phone,
    email: payload.email || null,
    address: payload.address || null,
    gst_number: payload.gst_number || payload.gstNumber || null,
    credit_limit: payload.credit_limit ?? payload.creditLimit ?? 0,
    current_balance: payload.current_balance ?? payload.currentBalance ?? 0,
    branch_id: payload.branch_id || payload.branchId || null,
    is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true
  };
};

const createSupplier = async (pool, payload) => {
  const input = buildSupplierInput(payload);
  if (!input.name) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }
  const result = await pool.query(
    `INSERT INTO suppliers (
      name,
      mobile,
      email,
      address,
      gst_number,
      credit_limit,
      current_balance,
      branch_id,
      is_active
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9
    )
    RETURNING *`,
    [
      input.name,
      input.mobile,
      input.email,
      input.address,
      input.gst_number,
      Number(input.credit_limit || 0),
      Number(input.current_balance || 0),
      input.branch_id,
      input.is_active
    ]
  );
  return result.rows[0];
};

const updateSupplier = async (pool, id, payload) => {
  const input = buildSupplierInput(payload);
  const result = await pool.query(
    `UPDATE suppliers
     SET name = COALESCE($1, name),
         mobile = COALESCE($2, mobile),
         email = COALESCE($3, email),
         address = COALESCE($4, address),
         gst_number = COALESCE($5, gst_number),
         credit_limit = COALESCE($6, credit_limit),
         current_balance = COALESCE($7, current_balance),
         branch_id = COALESCE($8, branch_id),
         is_active = COALESCE($9, is_active)
     WHERE id = $10
     RETURNING *`,
    [
      input.name,
      input.mobile,
      input.email,
      input.address,
      input.gst_number,
      Number.isFinite(Number(input.credit_limit)) ? Number(input.credit_limit) : null,
      Number.isFinite(Number(input.current_balance)) ? Number(input.current_balance) : null,
      input.branch_id,
      payload.is_active !== undefined ? Boolean(payload.is_active) : null,
      id
    ]
  );
  return result.rows[0] || null;
};

const listSuppliers = async (pool, { search = '', limit = 200, branch_id = null } = {}) => {
  const term = String(search || '').trim();
  const max = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 5000) : 200;
  const params = [];
  const conditions = [];
  let idx = 1;
  if (branch_id) {
    conditions.push(`(branch_id = $${idx} OR branch_id IS NULL)`);
    params.push(branch_id);
    idx += 1;
  }
  conditions.push('is_deleted = FALSE');
  if (term) {
    const like = `%${term}%`;
    conditions.push(
      `(LOWER(name) LIKE LOWER($${idx}) OR COALESCE(mobile, '') LIKE $${idx} OR LOWER(COALESCE(gst_number, '')) LIKE LOWER($${idx}))`
    );
    params.push(like);
    idx += 1;
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT id, name, mobile, email, gst_number, credit_limit, current_balance, branch_id, is_active, created_at, updated_at
     FROM suppliers
     ${whereClause}
     ORDER BY name ASC
     LIMIT $${idx}`,
    [...params, max]
  );
  return result.rows;
};

const getSupplierById = async (pool, id) => {
  const res = await pool.query('SELECT * FROM suppliers WHERE id = $1 AND is_deleted = FALSE', [id]);
  return res.rows[0] || null;
};

const normalizePaymentMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'cash';
  if (raw === 'upi' || raw === 'online') return 'online';
  if (raw === 'bank') return 'bank';
  return raw;
};

const addPayment = async (pool, id, payload) => {
  const amount = Number(payload.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('amount must be > 0');
    err.status = 400;
    throw err;
  }
  const mode = normalizePaymentMode(payload.payment_mode || payload.paymentMode || 'cash');
  const notes = payload.notes || null;
  const rawOrderId = payload.order_id ?? payload.orderId;
  const parsedOrderId = Number(rawOrderId);
  const orderId = Number.isFinite(parsedOrderId) && parsedOrderId > 0 ? parsedOrderId : null;
  const paymentDate = payload.date || payload.created_at || null;
  const clientTxnId = payload.client_txn_id || payload.clientTxnId || null;
  if (!clientTxnId) {
    const err = new Error('client_txn_id is required');
    err.status = 400;
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingTxnRes = await client.query(
      `SELECT id, created_at
       FROM transactions
       WHERE client_txn_id = $1
       LIMIT 1`,
      [clientTxnId]
    );
    if (existingTxnRes.rowCount > 0) {
      await client.query('COMMIT');
      return {
        payment: {
          id: existingTxnRes.rows[0].id,
          supplier_id: Number(id),
          amount,
          payment_mode: mode,
          notes,
          created_at: existingTxnRes.rows[0].created_at,
        },
        supplier: null,
        transaction: existingTxnRes.rows[0],
        idempotent: true,
      };
    }
    const supplierMetaRes = await client.query(
      `SELECT id, branch_id
       FROM suppliers
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    if (supplierMetaRes.rowCount === 0) {
      const err = new Error('supplier_id is invalid');
      err.status = 400;
      throw err;
    }

    let resolvedOrderId = null;
    if (Number.isFinite(orderId) && orderId > 0) {
      const purchaseRes = await client.query(
        `SELECT id, supplier_id, total_price, total_paid
         FROM orders
         WHERE id = $1
           AND transaction_type = 'purchase'
         FOR UPDATE`,
        [orderId]
      );
      if (purchaseRes.rowCount === 0) {
        const err = new Error('order_id is invalid');
        err.status = 400;
        throw err;
      }
      const purchase = purchaseRes.rows[0];
      if (Number(purchase.supplier_id || 0) !== Number(id)) {
        const err = new Error('Selected supplier does not match the purchase order supplier.');
        err.status = 400;
        throw err;
      }
      const outstanding = Math.max(Number(purchase.total_price || 0) - Number(purchase.total_paid || 0), 0);
      if (outstanding <= 0) {
        const err = new Error('This purchase order is already fully settled.');
        err.status = 400;
        throw err;
      }
      if (amount > outstanding) {
        const err = new Error(`amount cannot be greater than outstanding (${outstanding}).`);
        err.status = 400;
        throw err;
      }
      const nextTotalPaid = Number(purchase.total_paid || 0) + amount;
      const nextStatus = nextTotalPaid >= Number(purchase.total_price || 0) ? 'completed' : 'pending';
      await client.query(
        `UPDATE orders
         SET total_paid = $1,
             order_status = $2
         WHERE id = $3`,
        [nextTotalPaid, nextStatus, purchase.id]
      );
      resolvedOrderId = purchase.id;
    }

    const txnRes = await client.query(
      `INSERT INTO transactions (order_id, total_price, payment_mode, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id, client_txn_id)
       VALUES ($1, $2, $3, COALESCE($4, NOW()), $2, 'supplier', $5, 'out', 'payment', $6, $7, $8)
       RETURNING id, created_at`,
      [resolvedOrderId, amount, mode, paymentDate, id, notes, supplierMetaRes.rows[0].branch_id || null, clientTxnId]
    );

    await insertLedgerEntries({
      client,
      lines: [
        { ledger: 'Accounts Payable', debit: amount, credit: 0 },
        { ledger: resolveCashBankLedgerName(mode), debit: 0, credit: amount },
      ],
      transactionId: txnRes.rows[0]?.id || null,
      referenceId: Number.isFinite(resolvedOrderId) ? resolvedOrderId : Number(id),
      referenceType: 'payment',
      description: notes || `Supplier payment #${id}`,
      date: paymentDate,
      branchId: supplierMetaRes.rows[0].branch_id || null,
      clientTxnId: clientTxnId || null,
      syncStatus: 'SYNCED',
      partyType: 'supplier',
      partyId: Number(id),
    });

    await client.query('COMMIT');
    return {
      payment: {
        id: txnRes.rows[0]?.id || null,
        supplier_id: Number(id),
        amount,
        payment_mode: mode,
        notes,
        created_at: txnRes.rows[0]?.created_at || paymentDate || null,
      },
      supplier: supplierMetaRes.rows[0],
      transaction: txnRes.rows[0] || null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getLedger = async (pool, id) => {
  const ledgerRes = await pool.query(
    `SELECT le.id,
            le.date AS created_at,
            le.reference_type,
            le.reference_id,
            le.transaction_id,
            le.debit,
            le.credit,
            le.description,
            t.txn_type,
            t.payment_mode,
            t.notes,
            o.invoice_number
     FROM ledger_entries le
     JOIN ledgers l ON l.id = le.ledger_id
     LEFT JOIN transactions t ON t.id = le.transaction_id
     LEFT JOIN orders o ON o.id = le.reference_id
     WHERE le.party_type = 'supplier'
       AND le.party_id = $1
       AND l.name = 'Accounts Payable'
     ORDER BY le.date ASC, le.created_at ASC, le.id ASC`,
    [id]
  );

  let running = 0;
  return ledgerRes.rows.map((row) => {
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    running += credit - debit;
    let type = 'payment';
    const txnType = String(row.txn_type || '').toLowerCase();
    const refType = String(row.reference_type || '').toLowerCase();
    if (txnType === 'purchase' || refType === 'order') type = 'purchase';
    if (txnType === 'refund' || refType === 'return') type = 'return';
    if (txnType === 'payment') type = 'payment';
    return {
      id: row.transaction_id || row.reference_id || row.id,
      type,
      amount: Math.max(debit, credit),
      payment_mode: row.payment_mode || null,
      notes: row.notes || row.description || null,
      invoice_number: row.invoice_number || null,
      created_at: row.created_at,
      running_balance: running,
      debit,
      credit,
    };
  });
};

module.exports = {
  buildSupplierInput,
  createSupplier,
  updateSupplier,
  listSuppliers,
  getSupplierById,
  getLedger,
  addPayment
};
const { insertLedgerEntries, resolveCashBankLedgerName } = require('../../services/ledgerPostingService');
