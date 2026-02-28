const { jsonError, jsonOk } = require('../../utils/responses');

const normalizePaymentModeValue = (value) => {
  const mode = (value || '').toLowerCase();
  if (mode === 'upi' || mode === 'online') return 'online';
  if (mode === 'card' || mode === 'cash') return 'cash';
  return mode || null;
};

const resolveOrderLocation = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  return payload.location || payload.customer_location || null;
};

const isInteger = (value) => Number.isInteger(Number(value));

const buildCustomerPayload = (req) => {
  const { customer, customer_name, customer_phone, customer_address, customer_location, location } = req.body;
  if (customer && typeof customer === 'object') return customer;
  if (!customer_name && !customer_phone && !customer_address && !customer_location && !location) return null;
  return {
    name: customer_name,
    mobile: customer_phone,
    address: customer_address,
    location: customer_location || location || null
  };
};

const validateCustomer = (req) => {
  const { customer_id } = req.body;
  if (customer_id) return null;
  const resolvedCustomer = buildCustomerPayload(req);
  if (!resolvedCustomer) return null;
  if (!resolvedCustomer.name || !resolvedCustomer.mobile) {
    return 'Customer name and phone are required';
  }
  return null;
};

const upsertCustomer = async (tenantPool, customer) => {
  const { name, mobile, address, location } = customer;
  const existing = await tenantPool.query(
    'SELECT id FROM customers WHERE mobile = $1',
    [mobile]
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const insertRes = await tenantPool.query(
    'INSERT INTO customers (name, mobile, address, location) VALUES ($1, $2, $3, $4) RETURNING id',
    [name || null, mobile || null, address || null, location || null]
  );
  return insertRes.rows[0].id;
};

const createOrder = async (req, res) => {
  const { tenantPool, planFeatures } = req;
  const { items, payment_mode, order_date, customer_id } = req.body;
  const resolvedLocation = resolveOrderLocation(req.body);

  if (!Array.isArray(items) || items.length === 0) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Order items are required');
  }

  if (!planFeatures) {
    return jsonError(res, 500, 'FEATURE_FLAGS_MISSING', 'Feature configuration not found');
  }

  if (planFeatures.customer_details_enabled) {
    const customerError = validateCustomer(req);
    if (customerError) {
      return jsonError(res, 400, 'VALIDATION_ERROR', customerError);
    }
  }

  const client = await tenantPool.connect();
  try {
    await client.query('BEGIN');

    let resolvedCustomerId = customer_id || null;
    const resolvedCustomer = buildCustomerPayload(req);
    if (!resolvedCustomerId && resolvedCustomer) {
      resolvedCustomerId = await upsertCustomer(client, resolvedCustomer);
    }

    let totalPrice = 0;
    const preparedItems = [];

    for (const item of items) {
      const { product_id, quantity } = item;
      if (!product_id || quantity === undefined || quantity === null) {
        throw new Error('product_id and quantity are required');
      }

      const productRes = await client.query(
        'SELECT id, selling_price, stock_quantity, is_weight_based FROM products WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
        [product_id]
      );
      if (productRes.rowCount === 0) {
        throw new Error(`Product ${product_id} not found`);
      }
      const product = productRes.rows[0];
      const qty = Number(quantity);

      if (!planFeatures.enable_weight_based && !isInteger(qty)) {
        throw new Error('Decimal quantity is not allowed for this tenant');
      }
      if (!product.is_weight_based && !isInteger(qty)) {
        throw new Error('Decimal quantity is not allowed for this product');
      }
      if (Number(product.stock_quantity) < qty) {
        throw new Error(`Insufficient stock for product ${product_id}`);
      }

      const sellingPrice = Number(item.selling_price ?? product.selling_price);
      totalPrice += sellingPrice * qty;
      preparedItems.push({ product_id, qty, sellingPrice });
    }

    const resolvedPaymentMode = normalizePaymentModeValue(payment_mode);
    const isOnline = resolvedPaymentMode === 'online';
    const orderStatus = isOnline ? 'pending' : 'completed';
    const orderRes = await client.query(
      `INSERT INTO orders (customer_id, total_price, order_status, payment_mode, created_at, location, transaction_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [resolvedCustomerId, totalPrice, orderStatus, resolvedPaymentMode || null, order_date || new Date(), resolvedLocation, 'sale']
    );
    const orderId = orderRes.rows[0].id;
    for (const item of preparedItems) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, selling_price) VALUES ($1, $2, $3, $4)',
        [orderId, item.product_id, item.qty, item.sellingPrice]
      );
      await client.query(
        'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
        [item.qty, item.product_id]
      );
    }

    if (!isOnline) {
      await client.query(
        'INSERT INTO transactions (order_id, total_price, profit, payment_mode) VALUES ($1, $2, $3, $4)',
        [orderId, totalPrice, 0, resolvedPaymentMode || 'cash']
      );
    }

    await client.query('COMMIT');
    return jsonOk(res, { order_id: orderId, total_price: totalPrice }, 'Order created');
  } catch (error) {
    await client.query('ROLLBACK');
    return jsonError(res, 400, 'ORDER_CREATE_FAILED', error.message);
  } finally {
    client.release();
  }
};

module.exports = { createOrder };
