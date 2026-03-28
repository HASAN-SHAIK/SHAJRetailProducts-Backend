const { resolveGstPercentage } = require('./hsnGst.service');

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
};

const resolveIsGstEnabled = (req, payload) => {
  if (payload && payload.is_gst_enabled !== undefined) {
    return Boolean(payload.is_gst_enabled);
  }
  if (req?.planFeatures?.GST_invoice_enabled !== undefined) {
    return Boolean(req.planFeatures.GST_invoice_enabled);
  }
  return true;
};

const resolveProductGstPercentage = async (req, product) => {
  if (!product) return null;
  if (product.gst_percentage !== undefined && product.gst_percentage !== null) {
    const numeric = Number(product.gst_percentage);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return await resolveGstPercentage(req, product.hsn_code);
};

const createOrder = async (req, payload) => {
  const requestPool = req.tenantPool || req.pool;
  if (!requestPool) {
    throw buildValidationError('Tenant database connection is not available');
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) {
    throw buildValidationError('items must be a non-empty array');
  }

  const isGstEnabled = resolveIsGstEnabled(req, payload);

  const productIds = items.map((item) => item.product_id);
  const uniqueProductIds = Array.from(new Set(productIds));

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');

    const productsRes = await client.query(
      `SELECT id, hsn_code, gst_percentage
       FROM products
       WHERE id = ANY($1::int[])
         AND is_deleted = FALSE
       FOR UPDATE`,
      [uniqueProductIds]
    );

    if (productsRes.rowCount !== uniqueProductIds.length) {
      const found = new Set(productsRes.rows.map((row) => row.id));
      const missing = uniqueProductIds.find((id) => !found.has(id));
      throw buildValidationError(`Product ID ${missing} not found or deleted.`);
    }

    const productsById = new Map(productsRes.rows.map((row) => [row.id, row]));

    let totalAmount = 0;
    let gstAmount = 0;

    const orderItemProductIds = [];
    const orderItemQty = [];
    const orderItemPrices = [];
    const orderItemGstPercentages = [];
    const orderItemGstAmounts = [];
    const orderItemTotals = [];

    for (const item of items) {
      const productId = normalizeNumber(item.product_id);
      if (!Number.isFinite(productId)) {
        throw buildValidationError('product_id must be a valid number');
      }
      const qty = normalizeNumber(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw buildValidationError('quantity must be > 0');
      }
      const price = normalizeNumber(item.price);
      if (!Number.isFinite(price) || price < 0) {
        throw buildValidationError('price must be >= 0');
      }

      const product = productsById.get(productId);
      if (!product) {
        throw buildValidationError(`Product ID ${productId} not found or deleted.`);
      }

      let resolvedGstPercentage = 0;
      if (isGstEnabled) {
        const mapped = await resolveProductGstPercentage(req, product);
        if (mapped === null) {
          throw buildValidationError(`GST mapping not found for product ${productId}`);
        }
        resolvedGstPercentage = mapped;
      }
      const resolvedGstAmount = isGstEnabled ? (price * resolvedGstPercentage) / 100 : 0;
      const lineTotal = price * qty + resolvedGstAmount;

      totalAmount += lineTotal;
      gstAmount += resolvedGstAmount;

      orderItemProductIds.push(productId);
      orderItemQty.push(qty);
      orderItemPrices.push(price);
      orderItemGstPercentages.push(resolvedGstPercentage);
      orderItemGstAmounts.push(resolvedGstAmount);
      orderItemTotals.push(lineTotal);
    }

    const orderRes = await client.query(
      `INSERT INTO billing_orders (customer_id, total_amount, gst_amount, is_gst_enabled)
       VALUES ($1, $2, $3, $4)
       RETURNING id, bill_number, customer_id, total_amount, gst_amount, is_gst_enabled, created_at`,
      [payload.customer_id || null, totalAmount, gstAmount, isGstEnabled]
    );

    const order = orderRes.rows[0];

    await client.query(
      `INSERT INTO billing_order_items
        (order_id, product_id, quantity, price, gst_percentage, gst_amount, total)
       SELECT $1,
              unnest($2::int[]),
              unnest($3::numeric[]),
              unnest($4::numeric[]),
              unnest($5::numeric[]),
              unnest($6::numeric[]),
              unnest($7::numeric[])
      `,
      [
        order.id,
        orderItemProductIds,
        orderItemQty,
        orderItemPrices,
        orderItemGstPercentages,
        orderItemGstAmounts,
        orderItemTotals
      ]
    );

    await client.query('COMMIT');

    return {
      order,
      items: items.map((item, idx) => ({
        product_id: orderItemProductIds[idx],
        quantity: orderItemQty[idx],
        price: orderItemPrices[idx],
        gst_percentage: orderItemGstPercentages[idx],
        gst_amount: orderItemGstAmounts[idx],
        total: orderItemTotals[idx]
      }))
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getOrders = async (req, query) => {
  const requestPool = req.tenantPool || req.pool;
  if (!requestPool) {
    throw buildValidationError('Tenant database connection is not available');
  }

  const page = Math.max(parseInt(query?.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query?.limit, 10) || 10, 1), 100);
  const offset = (page - 1) * limit;

  const ordersRes = await requestPool.query(
    `SELECT id, bill_number, customer_id, total_amount, gst_amount, is_gst_enabled, created_at
     FROM billing_orders
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const totalRes = await requestPool.query(
    'SELECT COUNT(*)::int AS total_records FROM billing_orders'
  );

  const totalRecords = Number(totalRes.rows[0]?.total_records || 0);
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);

  return {
    orders: ordersRes.rows,
    pagination: {
      page,
      limit,
      total_records: totalRecords,
      total_pages: totalPages
    }
  };
};

const getOrderById = async (req, id) => {
  const requestPool = req.tenantPool || req.pool;
  if (!requestPool) {
    throw buildValidationError('Tenant database connection is not available');
  }

  const orderRes = await requestPool.query(
    `SELECT id, bill_number, customer_id, total_amount, gst_amount, is_gst_enabled, created_at
     FROM billing_orders
     WHERE id = $1`,
    [id]
  );

  if (orderRes.rowCount === 0) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  const itemsRes = await requestPool.query(
    `SELECT id, order_id, product_id, quantity, price, gst_percentage, gst_amount, total
     FROM billing_order_items
     WHERE order_id = $1
     ORDER BY id ASC`,
    [id]
  );

  return {
    order: orderRes.rows[0],
    items: itemsRes.rows
  };
};

module.exports = {
  createOrder,
  getOrders,
  getOrderById
};
