const { jsonError, jsonOk } = require('../../utils/responses');

const GST_MODES = new Set(['INCLUSIVE', 'EXCLUSIVE']);

const resolveGstMode = (req) => {
  const raw = req?.tenant?.gst_mode || req?.tenant?.gstMode || null;
  const mode = String(raw || 'INCLUSIVE').trim().toUpperCase();
  return GST_MODES.has(mode) ? mode : 'INCLUSIVE';
};

const normalizePaymentModeValue = (value) => {
  const mode = (value || '').toLowerCase();
  if (mode === 'online') return 'online';
  if (mode === 'upi') return 'online';
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

const fetchBatchAllocations = async (client, productId, branchId, quantity) => {
  const batchesRes = await client.query(
    `SELECT id,
            quantity,
            quantity_remaining,
            purchase_price,
            selling_price
     FROM batches
     WHERE product_id = $1
       AND is_deleted = FALSE
       AND ($2::uuid IS NULL OR branch_id = $2)
       AND COALESCE(quantity_remaining, quantity) > 0
       AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
     ORDER BY created_at ASC
     FOR UPDATE`,
    [productId, branchId]
  );

  if (batchesRes.rowCount === 0) {
    throw new Error(`Insufficient stock for product ${productId}`);
  }

  let remaining = quantity;
  const allocations = [];
  for (const batch of batchesRes.rows) {
    if (remaining <= 0) break;
    const available = Number(batch.quantity_remaining ?? batch.quantity ?? 0);
    if (available <= 0) continue;
    const deduct = Math.min(available, remaining);
    remaining -= deduct;
    allocations.push({
      batch_id: batch.id,
      quantity: deduct,
      purchase_price: batch.purchase_price ?? null,
      selling_price: batch.selling_price ?? null,
    });
  }

  if (remaining > 0) {
    throw new Error(`Insufficient stock for product ${productId}`);
  }

  return allocations;
};

const fetchSpecificBatchAllocation = async (client, batchId, productId, branchId, quantity) => {
  const batchRes = await client.query(
    `SELECT id,
            product_id,
            branch_id,
            quantity,
            quantity_remaining,
            purchase_price,
            selling_price
     FROM batches
     WHERE id = $1
       AND is_deleted = FALSE
     FOR UPDATE`,
    [batchId]
  );
  if (batchRes.rowCount === 0) {
    throw new Error(`Batch ${batchId} not found`);
  }
  const batch = batchRes.rows[0];
  if (productId && Number(batch.product_id) !== Number(productId)) {
    throw new Error(`Batch ${batchId} does not belong to product ${productId}`);
  }
  if (branchId && batch.branch_id && String(batch.branch_id) !== String(branchId)) {
    throw new Error(`Batch ${batchId} not available in selected branch`);
  }
  const available = Number(batch.quantity_remaining ?? batch.quantity ?? 0);
  if (!Number.isFinite(available) || available < quantity) {
    throw new Error(`Insufficient stock for batch ${batchId}`);
  }
  return [
    {
      batch_id: batch.id,
      quantity,
      purchase_price: batch.purchase_price ?? null,
      selling_price: batch.selling_price ?? null,
    }
  ];
};

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
  const { name, mobile, phone, address, location } = customer;
  const resolvedPhone = phone || mobile || null;
  const existing = await tenantPool.query(
    'SELECT id FROM customers WHERE COALESCE(phone, mobile) = $1',
    [resolvedPhone]
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const insertRes = await tenantPool.query(
    'INSERT INTO customers (name, mobile, phone, address, location) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name || null, mobile || resolvedPhone || null, resolvedPhone || null, address || null, location || null]
  );
  return insertRes.rows[0].id;
};

const createOrder = async (req, res) => {
  const { tenantPool, planFeatures } = req;
  const { items, payment_mode, order_date, customer_id, billing_type } = req.body;
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
    const billingType = String(billing_type || 'retail').toLowerCase();
    const resolvedPaymentMode = normalizePaymentModeValue(payment_mode);
    if ((billingType === 'wholesale' || resolvedPaymentMode === 'credit') && !resolvedCustomerId) {
      throw new Error('Customer is required for wholesale/credit billing');
    }

    let totalPrice = 0;
    let totalProfit = 0;
    const preparedItems = [];

    const productIds = [...new Set(items.map((item) => item.product_id))];
    if (productIds.some((id) => !id)) {
      throw new Error('product_id and quantity are required');
    }

    const productRes = await client.query(
      'SELECT id, gst_percentage, is_weight_based FROM products WHERE id = ANY($1) AND is_deleted = FALSE FOR UPDATE',
      [productIds]
    );
    if (productRes.rowCount !== productIds.length) {
      const foundIds = new Set(productRes.rows.map((row) => row.id));
      const missingId = productIds.find((id) => !foundIds.has(id));
      throw new Error(`Product ${missingId} not found`);
    }

    const productById = new Map(productRes.rows.map((row) => [row.id, row]));
    const batchUpdates = [];
    const branchId = req.body?.branch_id || null;

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

      const batchId = item.batch_id ?? item.batchId ?? null;
      const allocations = batchId
        ? await fetchSpecificBatchAllocation(client, batchId, product_id, branchId, qty)
        : await fetchBatchAllocations(client, product_id, branchId, qty);

      const rawDiscount = Number(item.discount_amount ?? item.discount ?? 0) || 0;
      const perUnitDiscount = qty > 0 ? rawDiscount / qty : 0;
      const gstPercent = Number(product.gst_percentage || 0) || 0;
      const overridePrice = item.selling_price ?? item.price ?? item.unit_price;

      for (const alloc of allocations) {
        const allocQty = Number(alloc.quantity);
        const sellingPrice = Number(overridePrice ?? alloc.selling_price);
        if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
          throw new Error('selling_price must be > 0');
        }
        const purchasePriceSnapshot = Number(alloc.purchase_price || 0);
        const discountAmount = perUnitDiscount * allocQty;
        const lineTotal = sellingPrice * allocQty;
        const profit = (sellingPrice - purchasePriceSnapshot) * allocQty - discountAmount;
        const marginPercent = lineTotal > 0 ? (profit / lineTotal) * 100 : 0;

        totalPrice += lineTotal - discountAmount;
        totalProfit += profit;
        preparedItems.push({
          product_id,
          batch_id: alloc.batch_id,
          qty: allocQty,
          sellingPrice,
          purchasePriceSnapshot,
          discountAmount,
          gstPercent,
          profit,
          marginPercent
        });
        batchUpdates.push({ batch_id: alloc.batch_id, quantity: allocQty });
      }
    }

    const discountTotal =
      Number(req.body?.discount_total ?? req.body?.discount ?? req.body?.discount_amount ?? 0) || 0;
    if (discountTotal > 0) {
      totalPrice = Math.max(totalPrice - discountTotal, 0);
      totalProfit = totalProfit - discountTotal;
    }

    const isOnline = resolvedPaymentMode === 'online';
    // UPI and cash-like modes should complete immediately; only true online sync-mode starts pending.
    const orderStatus = isOnline ? 'pending' : 'completed';
    const gstMode = resolveGstMode(req);
    const orderRes = await client.query(
      `INSERT INTO orders (customer_id, total_price, order_status, payment_mode, created_at, location, transaction_type, gst_mode, billing_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [resolvedCustomerId, totalPrice, orderStatus, resolvedPaymentMode || null, order_date || new Date(), resolvedLocation, 'sale', gstMode, billingType]
    );
    const orderId = orderRes.rows[0].id;
    const orderItemProductIds = preparedItems.map((item) => item.product_id);
    const orderItemBatchIds = preparedItems.map((item) => item.batch_id);
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
          batch_id,
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
              unnest($3::uuid[]),
              unnest($4::numeric[]),
              unnest($5::numeric[]),
              unnest($6::numeric[]),
              unnest($7::numeric[]),
              unnest($8::numeric[]),
              unnest($9::numeric[]),
              unnest($10::numeric[])`,
      [
        orderId,
        orderItemProductIds,
        orderItemBatchIds,
        orderItemQuantities,
        orderItemPrices,
        orderItemPurchaseSnapshots,
        orderItemDiscounts,
        orderItemGstPercents,
        orderItemProfits,
        orderItemMargins
      ]
    );

    for (const update of batchUpdates) {
      await client.query(
        `UPDATE batches
         SET quantity_remaining = quantity_remaining - $1
         WHERE id = $2`,
        [update.quantity, update.batch_id]
      );
    }

    if (!isOnline) {
      await client.query(
        'INSERT INTO transactions (order_id, total_price, profit, payment_mode, amount, party_type, party_id, direction, txn_type, notes, branch_id) VALUES ($1, $2, $3, $4, $2, $5, $6, $7, $8, NULL, $9)',
        [orderId, totalPrice, totalProfit, resolvedPaymentMode || 'cash', 'customer', resolvedCustomerId || null, 'in', 'sale', req.body?.branch_id || null]
      );
    }

    const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];
    const paidTotalFromPayload = payments.reduce((sum, payment) => {
      const amount = Number(payment?.amount_paid ?? payment?.amount ?? 0);
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
    // Backward-compat: if client didn't send payments for non-credit modes, treat as fully paid.
    const paidTotal =
      paidTotalFromPayload > 0
        ? paidTotalFromPayload
        : resolvedPaymentMode === 'credit'
          ? 0
          : Number(totalPrice || 0);
    const outstanding = Math.max(Number(totalPrice || 0) - paidTotal, 0);

    if (outstanding > 0) {
      if (!resolvedCustomerId) {
        throw new Error('Customer is required for partial/credit billing');
      }
      const creditRes = await client.query(
        'SELECT credit_limit, current_balance FROM customers WHERE id = $1 FOR UPDATE',
        [resolvedCustomerId]
      );
      if (creditRes.rowCount === 0) {
        throw new Error('Customer not found for credit billing');
      }
      const creditLimit = Number(creditRes.rows[0]?.credit_limit || 0);
      const currentBalance = Number(creditRes.rows[0]?.current_balance || 0);
      if (creditLimit <= 0) {
        throw new Error('Credit not allowed for this customer');
      }
      if (currentBalance + outstanding > creditLimit) {
        throw new Error('Customer credit limit exceeded');
      }
      await client.query(
        'UPDATE customers SET current_balance = COALESCE(current_balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [outstanding, resolvedCustomerId]
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
