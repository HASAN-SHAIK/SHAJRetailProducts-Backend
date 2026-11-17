const normalizePhone = (value) => {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  return digits || null;
};

const has = (payload, key) => Object.prototype.hasOwnProperty.call(payload, key);

const optionalValue = (payload, snakeKey, camelKey) => {
  if (has(payload, snakeKey) && payload[snakeKey] !== undefined) return payload[snakeKey];
  if (camelKey && has(payload, camelKey) && payload[camelKey] !== undefined) return payload[camelKey];
  return null;
};

// Presence-based optional text: omitted/null -> not provided (preserve);
// '' or whitespace -> provided and cleared (NULL); otherwise the provided value.
const resolveClearable = (payload, keys) => {
  for (const key of keys) {
    if (!has(payload, key)) continue;
    const raw = payload[key];
    if (raw === undefined || raw === null) continue;
    const text = String(raw).trim();
    return { provided: true, value: text === '' ? null : text };
  }
  return { provided: false, value: null };
};

const resolveAddress = (payload) => {
  const direct = resolveClearable(payload, ['address']);
  if (direct.provided) return direct;
  const l1 = resolveClearable(payload, ['address_line1', 'addressLine1']);
  const l2 = resolveClearable(payload, ['address_line2', 'addressLine2']);
  if (!l1.provided && !l2.provided) return { provided: false, value: null };
  const combined = [l1.value, l2.value].filter(Boolean).join(', ');
  return { provided: true, value: combined || null };
};

const buildCustomerInput = (payload = {}) => {
  const phone = normalizePhone(payload.phone || payload.mobile || payload.customer_phone);
  return {
    name: payload.name || payload.customer_name || null,
    phone,
    mobile: payload.mobile || phone || null,
    type: optionalValue(payload, 'type', 'customer_type'),
    email: resolveClearable(payload, ['email']),
    shop_name: resolveClearable(payload, ['shop_name', 'shopName']),
    gst_number: resolveClearable(payload, ['gst_number', 'gstNumber']),
    credit_limit: optionalValue(payload, 'credit_limit', 'creditLimit'),
    notes: resolveClearable(payload, ['notes']),
    is_active: payload.is_active !== undefined && payload.is_active !== null ? Boolean(payload.is_active) : null,
    location: resolveClearable(payload, ['location', 'customer_location', 'city', 'customer_city']),
    address: resolveAddress(payload),
  };
};

const duplicateError = (existing) => {
  const err = new Error('A customer with this mobile number already exists');
  err.status = 409;
  err.statusCode = 409;
  err.code = 'DUPLICATE_CUSTOMER';
  err.details = { existing_customer: existing };
  return err;
};

const withIgnored = (row, ignored) => (ignored.length ? { ...row, ignored_fields: ignored } : row);

const findByPhoneDigits = (db, digits, excludeId = null) =>
  db.query(
    `SELECT id, name, phone, mobile, type, email, shop_name, gst_number, credit_limit, current_balance, is_active
     FROM customers
     WHERE regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g') = $1
       AND ($2::bigint IS NULL OR id <> $2::bigint)
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [digits, excludeId]
  );

const lockPhone = (db, digits) =>
  db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`customer-phone:${digits}`]);

const inTransaction = async (pool, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // keep the original error
    }
    throw err;
  } finally {
    client.release();
  }
};

const createCustomer = async (pool, payload = {}, { canManageFinancials = false } = {}) => {
  const input = buildCustomerInput(payload);
  const digits = normalizePhone(input.phone || input.mobile);
  const creditProvided = input.credit_limit !== null && input.credit_limit !== undefined;
  const ignored = !canManageFinancials && creditProvided ? ['credit_limit'] : [];
  const creditLimit = canManageFinancials && creditProvided ? input.credit_limit : 0;

  const row = await inTransaction(pool, async (client) => {
    if (digits) {
      await lockPhone(client, digits);
      const existing = await findByPhoneDigits(client, digits);
      if (existing.rowCount > 0) throw duplicateError(existing.rows[0]);
    }
    const result = await client.query(
      `INSERT INTO customers (
        name, phone, mobile, type, email, shop_name, gst_number,
        credit_limit, current_balance, notes, is_active, location, address,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, COALESCE($4, 'retail'), $5, $6, $7,
        $8, 0, $9, COALESCE($10, TRUE), $11, $12, NOW(), NOW()
      )
      RETURNING *`,
      [
        input.name,
        input.phone,
        input.mobile,
        input.type,
        input.email.value,
        input.shop_name.value,
        input.gst_number.value,
        creditLimit,
        input.notes.value,
        input.is_active,
        input.location.value,
        input.address.value,
      ]
    );
    return result.rows[0];
  });
  return withIgnored(row, ignored);
};

const updateCustomer = async (pool, id, payload = {}, { canManageFinancials = false } = {}) => {
  const input = buildCustomerInput(payload);
  const creditProvided = input.credit_limit !== null && input.credit_limit !== undefined;
  const ignored = !canManageFinancials && creditProvided ? ['credit_limit'] : [];

  const run = async (db, lockOnPhone) => {
    const currentRes = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
    if (currentRes.rowCount === 0) return null;
    const current = currentRes.rows[0];

    if (lockOnPhone && input.phone) {
      const currentDigits = normalizePhone(current.phone || current.mobile);
      if (input.phone !== currentDigits) {
        await lockPhone(db, input.phone);
        const dup = await findByPhoneDigits(db, input.phone, current.id);
        if (dup.rowCount > 0) throw duplicateError(dup.rows[0]);
      }
    }

    const result = await db.query(
      `UPDATE customers
       SET name = $1,
           phone = $2,
           mobile = $3,
           type = $4,
           credit_limit = $5,
           is_active = $6,
           email = CASE WHEN $7::boolean THEN $8::text ELSE email END,
           shop_name = CASE WHEN $9::boolean THEN $10::text ELSE shop_name END,
           gst_number = CASE WHEN $11::boolean THEN $12::text ELSE gst_number END,
           notes = CASE WHEN $13::boolean THEN $14::text ELSE notes END,
           location = CASE WHEN $15::boolean THEN $16::text ELSE location END,
           address = CASE WHEN $17::boolean THEN $18::text ELSE address END,
           updated_at = NOW()
       WHERE id = $19
       RETURNING *`,
      [
        input.name ?? current.name,
        input.phone ?? current.phone,
        input.mobile ?? current.mobile,
        input.type ?? current.type,
        canManageFinancials && creditProvided ? input.credit_limit : current.credit_limit,
        input.is_active !== null ? input.is_active : current.is_active,
        input.email.provided, input.email.value,
        input.shop_name.provided, input.shop_name.value,
        input.gst_number.provided, input.gst_number.value,
        input.notes.provided, input.notes.value,
        input.location.provided, input.location.value,
        input.address.provided, input.address.value,
        id,
      ]
    );
    return result.rows[0];
  };

  const row = input.phone
    ? await inTransaction(pool, (client) => run(client, true))
    : await run(pool, false);
  return row ? withIgnored(row, ignored) : row;
};

const listCustomers = async (pool, { search = '', limit = 100 } = {}) => {
  const effectiveLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const term = String(search || '').trim();
  const digits = normalizePhone(term);

  let query = `
    SELECT *
    FROM customers
    WHERE is_active = TRUE
  `;
  const params = [];

  if (term) {
    if (digits) {
      params.push(`%${digits}%`);
      params.push(`%${term}%`);
      query += ` AND (
        regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g') ILIKE $1
        OR name ILIKE $2
        OR shop_name ILIKE $2
      )`;
    } else {
      params.push(`%${term}%`);
      query += ` AND (
        name ILIKE $1
        OR shop_name ILIKE $1
        OR email ILIKE $1
        OR location ILIKE $1
        OR address ILIKE $1
      )`;
    }
  }

  params.push(effectiveLimit);
  query += ` ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows;
};

const getCustomerById = async (pool, id) => {
  const customerRes = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
  if (customerRes.rowCount === 0) return null;
  const ordersRes = await pool.query(
    `SELECT id, order_number, total_price, order_status, payment_mode, created_at, billing_type
     FROM orders
     WHERE customer_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
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
      id: `order-${row.id}`,
      date: row.created_at,
      type: 'debit',
      description: `Order #${row.id} (${row.billing_type || 'Retail'})`,
      amount: Number(row.amount || 0),
      payment_mode: row.payment_mode,
    })),
    ...paymentsRes.rows.map((row) => ({
      id: `payment-${row.id}`,
      date: row.created_at,
      type: 'credit',
      description: `Payment Received (${row.payment_mode})`,
      amount: Number(row.amount || 0),
      payment_mode: row.payment_mode,
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  const ledger = entries.map((entry) => {
    if (entry.type === 'debit') {
      running += entry.amount;
    } else {
      running -= entry.amount;
    }
    return { ...entry, running_balance: running };
  });

  return ledger;
};

const sendPaymentReminder = async (pool, id, payload = {}, actor = {}) => {
  const customerId = Number(id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    const err = new Error('Invalid customer ID');
    err.status = 400;
    throw err;
  }

  const custRes = await pool.query(
    `SELECT id, name, phone, mobile, credit_balance, current_balance, branch_id
     FROM customers
     WHERE id = $1`,
    [customerId]
  );
  if (custRes.rowCount === 0) {
    const err = new Error('Customer not found');
    err.status = 404;
    throw err;
  }
  const customer = custRes.rows[0];
  const recipientPhone = String(payload.phone || customer.phone || customer.mobile || '').trim();
  if (!recipientPhone) {
    const err = new Error('Customer has no phone number on record for SMS reminder');
    err.status = 400;
    throw err;
  }

  const outstandingAmount = Math.max(0, Number(payload.amount ?? customer.current_balance ?? customer.credit_balance ?? 0));
  if (outstandingAmount <= 0) {
    const err = new Error('Customer has no outstanding balance to remind');
    err.status = 400;
    throw err;
  }

  const storeName = payload.storeName || 'SHAJ Retail';
  const upiId = payload.upiId || process.env.STORE_UPI_ID || 'shajretail@upi';
  const channel = String(payload.channel || 'sms').toLowerCase();
  const branchId = payload.branchId || customer.branch_id || null;

  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(storeName)}&am=${outstandingAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Khata-Customer-${customerId}`)}`;

  const messageText = payload.customMessage ||
    `Dear ${customer.name}, friendly reminder from ${storeName}: Your outstanding Khata balance is Rs.${outstandingAmount.toFixed(2)}. Pay easily via UPI: ${upiLink}. Thank you!`;

  const insertRes = await pool.query(
    `INSERT INTO customer_reminders (
      customer_id, branch_id, recipient_phone, amount, channel, message_text, upi_link, status, sent_by, sent_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'SENT', $8, NOW())
    RETURNING *`,
    [
      customerId,
      branchId,
      recipientPhone,
      outstandingAmount,
      channel,
      messageText,
      upiLink,
      actor.id || null,
    ]
  );

  const reminder = insertRes.rows[0];

  return {
    success: true,
    message: `Payment reminder ${channel.toUpperCase()} recorded and queued for delivery`,
    reminder: {
      id: reminder.id,
      customerId: reminder.customer_id,
      recipientPhone: reminder.recipient_phone,
      amount: Number(reminder.amount),
      channel: reminder.channel,
      messageText: reminder.message_text,
      upiLink: reminder.upi_link,
      status: reminder.status,
      sentAt: reminder.sent_at,
    },
  };
};

const getCustomerReminders = async (pool, id) => {
  const res = await pool.query(
    `SELECT id, customer_id, recipient_phone, amount, channel, message_text, upi_link, status, sent_at
     FROM customer_reminders
     WHERE customer_id = $1
     ORDER BY sent_at DESC
     LIMIT 50`,
    [id]
  );
  return res.rows;
};

module.exports = {
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomerById,
  addPayment,
  getLedger,
  buildCustomerInput,
  sendPaymentReminder,
  getCustomerReminders,
};
