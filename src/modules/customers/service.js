const normalizePhone = (value) => {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  return digits || null;
};

const buildCustomerInput = (payload = {}) => {
  const phone = normalizePhone(payload.phone || payload.mobile || payload.customer_phone);
  const rawAddress =
    payload.address ||
    payload.address_line1 ||
    payload.addressLine1 ||
    payload.address_line2 ||
    payload.addressLine2 ||
    null;
  const addressLine1 = payload.address_line1 || payload.addressLine1 || null;
  const addressLine2 = payload.address_line2 || payload.addressLine2 || null;
  const combinedAddress = [addressLine1, addressLine2].filter(Boolean).join(', ');
  const resolvedAddress = rawAddress || (combinedAddress ? combinedAddress : null);
  const resolvedLocation =
    payload.location || payload.customer_location || payload.city || payload.customer_city || null;
  return {
    name: payload.name || payload.customer_name || null,
    phone,
    mobile: payload.mobile || phone || null,
    type: payload.type || payload.customer_type || 'retail',
    email: payload.email || null,
    shop_name: payload.shop_name || payload.shopName || null,
    gst_number: payload.gst_number || payload.gstNumber || null,
    credit_limit: payload.credit_limit ?? payload.creditLimit ?? 0,
    current_balance: payload.current_balance ?? payload.currentBalance ?? null,
    notes: payload.notes || null,
    is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true,
    location: resolvedLocation,
    address: resolvedAddress,
  };
};

const createCustomer = async (pool, payload) => {
  const input = buildCustomerInput(payload);
  const normalizedPhone = normalizePhone(input.phone || input.mobile);
  let existingRes;
  if (normalizedPhone) {
    existingRes = await pool.query(
      `SELECT id
       FROM customers
       WHERE regexp_replace(COALESCE(phone, mobile, ''), '\D', '', 'g') = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [normalizedPhone]
    );
  } else {
    existingRes = await pool.query(
      `SELECT id
       FROM customers
       WHERE LOWER(TRIM(COALESCE(name, ''))) = LOWER(TRIM($1))
         AND COALESCE(NULLIF(regexp_replace(COALESCE(phone, mobile, ''), '\D', '', 'g'), ''), '') = ''
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [input.name || '']
    );
  }
  if (existingRes.rowCount > 0) {
    return updateCustomer(pool, existingRes.rows[0].id, payload);
  }
  const result = await pool.query(
    `INSERT INTO customers (
      name,
      mobile,
      phone,
      type,
      email,
      shop_name,
      gst_number,
      credit_limit,
      current_balance,
      notes,
      is_active,
      location,
      address,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10,$11,$12,$13,NOW()
    )
    RETURNING *`,
    [
      input.name,
      input.mobile,
      input.phone,
      input.type,
      input.email,
      input.shop_name,
      input.gst_number,
      Number(input.credit_limit || 0),
      Number.isFinite(Number(input.current_balance)) ? Number(input.current_balance) : 0,
      input.notes,
      input.is_active,
      input.location,
      input.address
    ]
  );
  return result.rows[0];
};

const updateCustomer = async (pool, id, payload) => {
  const input = buildCustomerInput(payload);
  const result = await pool.query(
    `UPDATE customers
     SET name = COALESCE($1, name),
         mobile = COALESCE($2, mobile),
         phone = COALESCE($3, phone),
         type = COALESCE($4, type),
         email = COALESCE($5, email),
         shop_name = COALESCE($6, shop_name),
         gst_number = COALESCE($7, gst_number),
         credit_limit = COALESCE($8, credit_limit),
         current_balance = COALESCE($9, current_balance),
         notes = COALESCE($10, notes),
         is_active = COALESCE($11, is_active),
         location = COALESCE($12, location),
         address = COALESCE($13, address),
         updated_at = NOW()
     WHERE id = $14
     RETURNING *`,
    [
      input.name,
      input.mobile,
      input.phone,
      input.type,
      input.email,
      input.shop_name,
      input.gst_number,
      Number.isFinite(Number(input.credit_limit)) ? Number(input.credit_limit) : null,
      Number.isFinite(Number(input.current_balance)) ? Number(input.current_balance) : null,
      input.notes,
      payload.is_active !== undefined ? Boolean(payload.is_active) : null,
      input.location,
      input.address,
      id
    ]
  );
  return result.rows[0] || null;
};

const listCustomers = async (pool, { search = '', limit = 100 } = {}) => {
  const term = String(search || '').trim();
  const max = Number.isFinite(Number(limit)) ? Math.min(Number(limit), 5000) : 100;
  const dedupeExpr = `COALESCE(NULLIF(regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g'), ''), CONCAT('name:', LOWER(TRIM(COALESCE(name, '')))))`;
  if (!term) {
    const result = await pool.query(
      `SELECT id, name, phone, type, current_balance, credit_limit, shop_name, gst_number, is_active, address, location
       FROM (
         SELECT DISTINCT ON (${dedupeExpr})
                id,
                name,
                COALESCE(phone, mobile) AS phone,
                type,
                current_balance,
                credit_limit,
                shop_name,
                gst_number,
                is_active,
                address,
                location,
                ${dedupeExpr} AS dedupe_key
         FROM customers
         ORDER BY ${dedupeExpr}, updated_at DESC NULLS LAST, id DESC
       ) c
       ORDER BY name ASC
       LIMIT $1`,
      [max]
    );
    return result.rows;
  }
  const like = `%${term}%`;
  const result = await pool.query(
    `SELECT id, name, phone, type, current_balance, credit_limit, shop_name, gst_number, is_active, address, location
     FROM (
       SELECT DISTINCT ON (${dedupeExpr})
              id,
              name,
              COALESCE(phone, mobile) AS phone,
              type,
              current_balance,
              credit_limit,
              shop_name,
              gst_number,
              is_active,
              address,
              location,
              ${dedupeExpr} AS dedupe_key
       FROM customers
       WHERE LOWER(name) LIKE LOWER($1)
          OR COALESCE(phone, mobile, '') LIKE $1
          OR LOWER(COALESCE(shop_name, '')) LIKE LOWER($1)
       ORDER BY ${dedupeExpr}, updated_at DESC NULLS LAST, id DESC
     ) c
     ORDER BY name ASC
     LIMIT $2`,
    [like, max]
  );
  return result.rows;
};

const getCustomerById = async (pool, id) => {
  const customerRes = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
  if (customerRes.rowCount === 0) return null;
  const ordersRes = await pool.query(
    `SELECT id, total_price, total_paid, payment_mode, transaction_type, billing_type, order_status, created_at
     FROM orders
     WHERE customer_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [id]
  );
  const paymentsRes = await pool.query(
    `SELECT id, amount, payment_mode, notes, created_at
     FROM customer_payments
     WHERE customer_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [id]
  );
  return {
    customer: customerRes.rows[0],
    orders: ordersRes.rows,
    payments: paymentsRes.rows
  };
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
      `INSERT INTO customer_payments (customer_id, amount, payment_mode, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, amount, mode, notes]
    );
    await client.query('COMMIT');
    const currentCustomer = await client.query('SELECT * FROM customers WHERE id = $1', [id]);
    return { payment: paymentRes.rows[0], customer: currentCustomer.rows[0] || null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getLedger = async (pool, id) => {
  const ordersRes = await pool.query(
    `SELECT id, total_price AS amount, payment_mode, created_at, billing_type
     FROM orders
     WHERE customer_id = $1
     ORDER BY created_at ASC`,
    [id]
  );
  const paymentsRes = await pool.query(
    `SELECT id, amount, payment_mode, created_at
     FROM customer_payments
     WHERE customer_id = $1
     ORDER BY created_at ASC`,
    [id]
  );

  const entries = [
    ...ordersRes.rows.map((row) => ({
      type: 'order',
      id: row.id,
      amount: Number(row.amount || 0),
      payment_mode: row.payment_mode || null,
      billing_type: row.billing_type || null,
      created_at: row.created_at
    })),
    ...paymentsRes.rows.map((row) => ({
      type: 'payment',
      id: row.id,
      amount: Number(row.amount || 0),
      payment_mode: row.payment_mode || null,
      created_at: row.created_at
    }))
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  let running = 0;
  const ledger = entries.map((entry) => {
    if (entry.type === 'order' && String(entry.payment_mode || '').toLowerCase() === 'credit') {
      running += Number(entry.amount || 0);
    }
    if (entry.type === 'payment') {
      running -= Number(entry.amount || 0);
    }
    return { ...entry, running_balance: running };
  });

  return ledger;
};

module.exports = {
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomerById,
  addPayment,
  getLedger,
  buildCustomerInput
};
