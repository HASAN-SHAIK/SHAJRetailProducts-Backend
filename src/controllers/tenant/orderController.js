const { jsonError, jsonOk } = require('../../utils/responses');

const normalizePaymentModeValue = (value) => {
  const mode = (value || '').toLowerCase();
  if (mode === 'upi' || mode === 'online') return 'online';
  if (mode === 'card' || mode === 'cash') return 'cash';
  return mode || null;
};

const resolveOrderLocation = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload.location || payload.customer_location || 'Other';
  const cleaned = typeof raw === 'string' ? raw.trim() : raw;
  return cleaned ? cleaned : 'Other';
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
    let totalProfit = 0;
    const preparedItems = [];

    const productIds = [...new Set(items.map((item) => item.product_id))];
    if (productIds.some((id) => !id)) {
      throw new Error('product_id and quantity are required');
    }

    const productRes = await client.query(
      'SELECT id, selling_price, purchase_price, gst_percentage, stock_quantity, is_weight_based FROM products WHERE id = ANY($1) AND is_deleted = FALSE FOR UPDATE',
      [productIds]
    );
    if (productRes.rowCount !== productIds.length) {
      const foundIds = new Set(productRes.rows.map((row) => row.id));
      const missingId = productIds.find((id) => !foundIds.has(id));
      throw new Error(`Product ${missingId} not found`);
    }

    const productById = new Map(productRes.rows.map((row) => [row.id, row]));
    const requestedQtyByProduct = new Map();

    for (const item of items) {
      const { product_id, quantity } = item;
      if (quantity === undefined || quantity === null) {
        throw new Error('product_id and quantity are required');
      }
      const product = productById.get(product_id);
      const qty = Number(quantity);

      if (!planFeatures.enable_weight_based && !isInteger(qty)) {
        throw new Error('Decimal quantity is not allowed for this tenant');
      }
      if (!product.is_weight_based && !isInteger(qty)) {
        throw new Error('Decimal quantity is not allowed for this product');
      }

      const sellingPrice = Number(item.selling_price ?? item.price ?? item.unit_price ?? product.selling_price);
      if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
        throw new Error('selling_price must be > 0');
      }
      const purchasePriceSnapshot = Number(product.purchase_price || 0);
      const discountAmount = Number(item.discount_amount ?? item.discount ?? 0) || 0;
      const gstPercent = Number(product.gst_percentage || 0) || 0;
      const lineTotal = sellingPrice * qty;
      const profit = (sellingPrice - purchasePriceSnapshot) * qty - discountAmount;
      const marginPercent = lineTotal > 0 ? (profit / lineTotal) * 100 : 0;

      totalPrice += lineTotal - discountAmount;
      totalProfit += profit;
      preparedItems.push({
        product_id,
        qty,
        sellingPrice,
        purchasePriceSnapshot,
        discountAmount,
        gstPercent,
        profit,
        marginPercent
      });

      const prevQty = requestedQtyByProduct.get(product_id) || 0;
      requestedQtyByProduct.set(product_id, prevQty + qty);
    }

    for (const [productId, totalQty] of requestedQtyByProduct.entries()) {
      const product = productById.get(productId);
      if (Number(product.stock_quantity) < totalQty) {
        throw new Error(`Insufficient stock for product ${productId}`);
      }
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
    const orderItemProductIds = preparedItems.map((item) => item.product_id);
    const orderItemQuantities = preparedItems.map((item) => item.qty);
    const orderItemPrices = preparedItems.map((item) => item.sellingPrice);
    const orderItemPurchaseSnapshots = preparedItems.map((item) => item.purchasePriceSnapshot);
    const orderItemDiscounts = preparedItems.map((item) => item.discountAmount);
    const orderItemGstPercents = preparedItems.map((item) => item.gstPercent);
    const orderItemProfits = preparedItems.map((item) => item.profit);
    const orderItemMargins = preparedItems.map((item) => item.marginPercent);

    await client.query(
      `INSERT INTO order_items (
          order_id,
          product_id,
          quantity,
          selling_price,
          purchase_price_snapshot,
          discount_amount,
          gst_percent,
          profit,
          margin_percent
       )
       SELECT $1,
              unnest($2::int[]),
              unnest($3::numeric[]),
              unnest($4::numeric[]),
              unnest($5::numeric[]),
              unnest($6::numeric[]),
              unnest($7::numeric[]),
              unnest($8::numeric[]),
              unnest($9::numeric[])`,
      [
        orderId,
        orderItemProductIds,
        orderItemQuantities,
        orderItemPrices,
        orderItemPurchaseSnapshots,
        orderItemDiscounts,
        orderItemGstPercents,
        orderItemProfits,
        orderItemMargins
      ]
    );

    const stockProductIds = [];
    const stockQuantities = [];
    for (const [productId, totalQty] of requestedQtyByProduct.entries()) {
      stockProductIds.push(productId);
      stockQuantities.push(totalQty);
    }

    await client.query(
      `UPDATE products p
       SET stock_quantity = p.stock_quantity - u.qty
       FROM (
         SELECT unnest($1::int[]) AS product_id, unnest($2::numeric[]) AS qty
       ) AS u
       WHERE p.id = u.product_id`,
      [stockProductIds, stockQuantities]
    );

    if (!isOnline) {
      await client.query(
        'INSERT INTO transactions (order_id, total_price, profit, payment_mode) VALUES ($1, $2, $3, $4)',
        [orderId, totalPrice, totalProfit, resolvedPaymentMode || 'cash']
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
