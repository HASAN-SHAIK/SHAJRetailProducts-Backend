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

const addPayment = async (pool, id, payload) => {
  const amount = Number(payload.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('amount must be > 0');
    err.status = 400;
    throw err;
  }
  const mode = payload.payment_mode || payload.paymentMode || 'cash';
  const notes = payload.notes || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const paymentRes = await client.query(
      `INSERT INTO supplier_payments (supplier_id, amount, payment_mode, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, amount, mode, notes]
    );
    const supplierRes = await client.query(
      `UPDATE suppliers
       SET current_balance = COALESCE(current_balance, 0) - $1
       WHERE id = $2
       RETURNING *`,
      [amount, id]
    );
    await client.query('COMMIT');
    return { payment: paymentRes.rows[0], supplier: supplierRes.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getLedger = async (pool, id) => {
  const purchasesRes = await pool.query(
    `SELECT id,
            total_price AS amount,
            payment_mode,
            invoice_number,
            created_at
     FROM orders
     WHERE supplier_id = $1
       AND transaction_type = 'purchase'
     ORDER BY created_at ASC`,
    [id]
  );
  const returnsRes = await pool.query(
    `SELECT id,
            total_amount AS amount,
            created_at
     FROM purchase_returns
     WHERE supplier_id = $1
     ORDER BY created_at ASC`,
    [id]
  );
  const paymentsRes = await pool.query(
    `SELECT id,
            amount,
            payment_mode,
            notes,
            created_at
     FROM supplier_payments
     WHERE supplier_id = $1
     ORDER BY created_at ASC`,
    [id]
  );

  const entries = [
    ...purchasesRes.rows.map((row) => ({
      type: 'purchase',
      id: row.id,
      amount: Number(row.amount || 0),
      payment_mode: row.payment_mode || null,
      invoice_number: row.invoice_number || null,
      created_at: row.created_at
    })),
    ...returnsRes.rows.map((row) => ({
      type: 'return',
      id: row.id,
      amount: Number(row.amount || 0),
      payment_mode: null,
      created_at: row.created_at
    })),
    ...paymentsRes.rows.map((row) => ({
      type: 'payment',
      id: row.id,
      amount: Number(row.amount || 0),
      payment_mode: row.payment_mode || null,
      notes: row.notes || null,
      created_at: row.created_at
    }))
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  let running = 0;
  const ledger = entries.map((entry) => {
    if (entry.type === 'purchase' && String(entry.payment_mode || '').toLowerCase() === 'credit') {
      running += Number(entry.amount || 0);
    }
    if (entry.type === 'return' || entry.type === 'payment') {
      running -= Number(entry.amount || 0);
    }
    return { ...entry, running_balance: running };
  });

  return ledger;
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
