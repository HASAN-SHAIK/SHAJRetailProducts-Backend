const normalizePhone = (value) => {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  return digits || null;
};

const optionalValue = (payload, snakeKey, camelKey) => {
  if (Object.prototype.hasOwnProperty.call(payload, snakeKey)) return payload[snakeKey];
  if (camelKey && Object.prototype.hasOwnProperty.call(payload, camelKey)) return payload[camelKey];
  return null;
};

// Optional text fields a caller may explicitly clear. An omitted (or null)
// key preserves the stored value; an explicit empty/whitespace string clears it.
const CLEARABLE_FIELDS = ['email', 'notes', 'shop_name', 'gst_number', 'address', 'location'];

const isExplicitEmpty = (payload, ...keys) =>
  keys.some(
    (key) =>
      Object.prototype.hasOwnProperty.call(payload, key) &&
      typeof payload[key] === 'string' &&
      payload[key].trim() === ''
  );

const buildClearFlags = (payload = {}) => ({
  email: isExplicitEmpty(payload, 'email'),
  notes: isExplicitEmpty(payload, 'notes'),
  shop_name: isExplicitEmpty(payload, 'shop_name', 'shopName'),
  gst_number: isExplicitEmpty(payload, 'gst_number', 'gstNumber'),
  address: isExplicitEmpty(payload, 'address'),
  location: isExplicitEmpty(payload, 'location'),
});

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
    type: optionalValue(payload, 'type', 'customer_type'),
    email: payload.email || null,
    shop_name: payload.shop_name || payload.shopName || null,
    gst_number: payload.gst_number || payload.gstNumber || null,
    credit_limit: optionalValue(payload, 'credit_limit', 'creditLimit'),
    notes: payload.notes || null,
    is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : null,
    location: resolvedLocation,
    address: resolvedAddress,
  };
};

const toFiniteOrNull = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

const duplicateCustomerError = (existing) => {
  const error = new Error('A customer with this mobile number already exists');
  error.status = 409;
  error.statusCode = 409;
  error.code = 'DUPLICATE_CUSTOMER';
  error.details = { existing_customer: existing };
  return error;
};

const findByPhone = (db, normalizedPhone, excludeId = null) =>
  db.query(
    `SELECT id, name, mobile, phone, type, email, shop_name, gst_number, credit_limit, current_balance, is_active
     FROM customers
     WHERE regexp_replace(COALESCE(NULLIF(phone, ''), mobile, ''), '\\D', '', 'g') = $1
       AND ($2::bigint IS NULL OR id <> $2::bigint)
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [normalizedPhone, excludeId]
  );

// There is no unique index on customers.phone (existing tenants may already hold
// duplicates, so adding one needs a data clean-up first). Until then, concurrent
// creates for one number are serialised with a transaction-scoped advisory lock.
// Pools without connect() (unit-test fakes) run the same steps unlocked.
const withPhoneLock = async (pool, normalizedPhone, work) => {
  if (!normalizedPhone || !pool || typeof pool.connect !== 'function') return work(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`customer-phone:${normalizedPhone}`]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // keep the original error
    }
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Creates a customer. Never merges into an existing one: a duplicate mobile
 * throws a 409 DUPLICATE_CUSTOMER carrying the existing record untouched.
 * current_balance always starts at 0; credit_limit is honoured only when
 * `options.canManageFinancials` is true (default deny).
 */
const createCustomer = async (pool, payload, options = {}) => {
  const input = buildCustomerInput(payload);
  const normalizedPhone = normalizePhone(input.phone || input.mobile);
  const canManageFinancials = options.canManageFinancials === true;
  return withPhoneLock(pool, normalizedPhone, async (db) => {
    if (normalizedPhone) {
      const existingRes = await findByPhone(db, normalizedPhone);
      if (existingRes.rowCount > 0) throw duplicateCustomerError(existingRes.rows[0]);
    }
    const result = await db.query(
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
        $1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,NOW()
      )
      RETURNING *`,
      [
        input.name,
        input.mobile,
        input.phone,
        input.type || 'retail',
        input.email,
        input.shop_name,
        input.gst_number,
        canManageFinancials ? toFiniteOrNull(input.credit_limit) ?? 0 : 0,
        input.notes,
        input.is_active !== null ? input.is_active : true,
        input.location,
        input.address,
      ]
    );
    return result.rows[0];
  });
};

/**
 * Updates a customer. Omitted/null fields are preserved; explicit empty strings
 * clear the optional text fields. current_balance is never written here and
 * credit_limit only when `options.canManageFinancials` is true.
 */
const updateCustomer = async (pool, id, payload, options = {}) => {
  const input = buildCustomerInput(payload);
  const clear = buildClearFlags(payload);
  const canManageFinancials = options.canManageFinancials === true;
  const newPhone = normalizePhone(input.phone || input.mobile);
  return withPhoneLock(pool, newPhone, async (db) => {
    if (newPhone) {
      const currentRes = await db.query(
        `SELECT regexp_replace(COALESCE(NULLIF(phone, ''), mobile, ''), '\\D', '', 'g') AS digits
         FROM customers WHERE id = $1`,
        [id]
      );
      const currentDigits = currentRes.rows && currentRes.rows[0] ? currentRes.rows[0].digits : null;
      if (currentRes.rowCount > 0 && currentDigits !== newPhone) {
        const clash = await findByPhone(db, newPhone, id);
        if (clash.rowCount > 0) throw duplicateCustomerError(clash.rows[0]);
      }
    }
    const result = await db.query(
      `UPDATE customers
       SET name = COALESCE($1, name),
           mobile = COALESCE($2, mobile),
           phone = COALESCE($3, phone),
           type = COALESCE($4, type),
           email = CASE WHEN $14 THEN NULL ELSE COALESCE($5, email) END,
           shop_name = CASE WHEN $16 THEN NULL ELSE COALESCE($6, shop_name) END,
           gst_number = CASE WHEN $17 THEN NULL ELSE COALESCE($7, gst_number) END,
           credit_limit = COALESCE($8, credit_limit),
           notes = CASE WHEN $15 THEN NULL ELSE COALESCE($9, notes) END,
           is_active = COALESCE($10, is_active),
           location = CASE WHEN $19 THEN NULL ELSE COALESCE($11, location) END,
           address = CASE WHEN $18 THEN NULL ELSE COALESCE($12, address) END,
           updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [
        input.name,
        input.mobile,
        input.phone,
        input.type,
        input.email,
        input.shop_name,
        input.gst_number,
        canManageFinancials ? toFiniteOrNull(input.credit_limit) : null,
        input.notes,
        input.is_active,
        input.location,
        input.address,
        id,
        clear.email,
        clear.notes,
        clear.shop_name,
        clear.gst_number,
        clear.address,
        clear.location,
      ]
    );
    return result.rows[0] || null;
  });
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
