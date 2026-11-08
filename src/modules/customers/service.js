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
    current_balance: optionalValue(payload, 'current_balance', 'currentBalance'),
    notes: payload.notes || null,
    is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : null,
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
       WHERE regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g') = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [normalizedPhone]
    );
  } else {
    existingRes = await pool.query(
      `SELECT id
       FROM customers
       WHERE LOWER(TRIM(COALESCE(name, ''))) = LOWER(TRIM($1))
         AND COALESCE(NULLIF(regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g'), ''), '') = ''
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
      phone,
      mobile,
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
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      COALESCE($11, TRUE), $12, $13, NOW(), NOW()
    )
    RETURNING *`,
    [
      input.name,
      input.phone,
      input.mobile,
      input.type,
      input.email,
      input.shop_name,
      input.gst_number,
      input.credit_limit,
      input.current_balance,
      input.notes,
      input.is_active,
      input.location,
      input.address
    ]
  );
  return result.rows[0];
};

const updateCustomer = async (pool, id, payload) => {
  const currentRes = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
  if (currentRes.rowCount === 0) return null;
  const current = currentRes.rows[0];
  const input = buildCustomerInput(payload);

  const fields = {
    name: input.name ?? current.name,
    phone: input.phone ?? current.phone,
    mobile: input.mobile ?? current.mobile,
    type: input.type ?? current.type,
    email: input.email ?? current.email,
    shop_name: input.shop_name ?? current.shop_name,
    gst_number: input.gst_number ?? current.gst_number,
    credit_limit: input.credit_limit ?? current.credit_limit,
    current_balance: input.current_balance ?? current.current_balance,
    notes: input.notes ?? current.notes,
    is_active: input.is_active !== null ? input.is_active : current.is_active,
    location: input.location ?? current.location,
    address: input.address ?? current.address
  };

  const result = await pool.query(
    `UPDATE customers
     SET name = $1,
         phone = $2,
         mobile = $3,
         type = $4,
         email = $5,
         shop_name = $6,
         gst_number = $7,
         credit_limit = $8,
         current_balance = $9,
         notes = $10,
         is_active = $11,
         location = $12,
         address = $13,
         updated_at = NOW()
     WHERE id = $14
     RETURNING *`,
    [
      fields.name,
      fields.phone,
      fields.mobile,
      fields.type,
      fields.email,
      fields.shop_name,
      fields.gst_number,
      fields.credit_limit,
      fields.current_balance,
      fields.notes,
      fields.is_active,
      fields.location,
      fields.address,
      id
    ]
  );
  return result.rows[0];
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
