const getOrderPayload = (payload = {}) => payload?.order || payload;

const getLineItems = (orderPayload = {}) => {
  if (Array.isArray(orderPayload.products)) return orderPayload.products;
  if (Array.isArray(orderPayload.items)) return orderPayload.items;
  return [];
};

const normalizeQuantity = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const validateSalesInventory = async (tenantPool, payload = {}, { existingOrderId = null } = {}) => {
  const order = getOrderPayload(payload);
  const transactionType = String(order.transaction_type || order.type || 'sale').toLowerCase();
  if (transactionType !== 'sale') {
    return { ok: true };
  }

  const items = getLineItems(order);
  if (!items.length) {
    return { ok: true };
  }

  const requiredByProduct = new Map();
  items.forEach((item) => {
    const productId = item?.product_id ?? item?.productId;
    const qty = normalizeQuantity(item?.quantity);
    if (!productId || qty <= 0) return;
    requiredByProduct.set(productId, (requiredByProduct.get(productId) || 0) + qty);
  });

  if (requiredByProduct.size === 0) {
    return { ok: true };
  }

  const productIds = [...requiredByProduct.keys()];
  const productsRes = await tenantPool.query(
    `SELECT id, stock_quantity, is_deleted, name
     FROM products
     WHERE id = ANY($1::int[])`,
    [productIds]
  );

  const productById = new Map(productsRes.rows.map((row) => [row.id, row]));
  const consumedByProduct = new Map();

  if (existingOrderId) {
    const consumedRes = await tenantPool.query(
      `SELECT product_id, COALESCE(SUM(quantity), 0) AS consumed
       FROM order_items
       WHERE order_id = $1
         AND product_id = ANY($2::int[])
       GROUP BY product_id`,
      [existingOrderId, productIds]
    );
    consumedRes.rows.forEach((row) => {
      consumedByProduct.set(row.product_id, Number(row.consumed ?? 0));
    });
  }

  const violations = [];

  for (const [productId, requiredQty] of requiredByProduct.entries()) {
    const product = productById.get(Number(productId)) || productById.get(productId);
    if (!product || product.is_deleted) {
      violations.push({
        product_id: productId,
        code: 'PRODUCT_NOT_FOUND',
        required: requiredQty,
      });
      continue;
    }

    let available = Number(product.stock_quantity ?? 0);
    if (existingOrderId) {
      available += consumedByProduct.get(Number(productId)) || consumedByProduct.get(productId) || 0;
    }

    if (available < requiredQty) {
      violations.push({
        product_id: productId,
        product_name: product.name,
        code: 'INSUFFICIENT_STOCK',
        available,
        required: requiredQty,
      });
    }
  }

  if (violations.length > 0) {
    return { ok: false, code: 'INVENTORY_PROTECTION', violations };
  }

  return { ok: true };
};

const validateInventoryAdjustment = async (tenantPool, payload = {}) => {
  const productId = payload?.product_id ?? payload?.productId ?? payload?.id;
  const delta = Number(payload?.quantity_delta ?? payload?.stock_delta ?? payload?.adjustment);
  if (!productId || !Number.isFinite(delta) || delta >= 0) {
    return { ok: true };
  }

  const result = await tenantPool.query(
    `SELECT id, stock_quantity, is_deleted, name
     FROM products
     WHERE id = $1
     LIMIT 1`,
    [productId]
  );
  const product = result.rows[0];
  if (!product || product.is_deleted) {
    return {
      ok: false,
      code: 'INVENTORY_PROTECTION',
      violations: [{ product_id: productId, code: 'PRODUCT_NOT_FOUND' }],
    };
  }

  const nextStock = Number(product.stock_quantity ?? 0) + delta;
  if (nextStock < 0) {
    return {
      ok: false,
      code: 'INVENTORY_PROTECTION',
      violations: [
        {
          product_id: productId,
          product_name: product.name,
          code: 'NEGATIVE_STOCK',
          available: Number(product.stock_quantity ?? 0),
          required: Math.abs(delta),
        },
      ],
    };
  }

  return { ok: true };
};

const validateInventoryProtection = async (
  tenantPool,
  { module, entityType, payload, serverState, action }
) => {
  if (module === 'sales' && entityType === 'order') {
    return validateSalesInventory(tenantPool, payload, {
      existingOrderId: serverState?.id || null,
    });
  }

  if (
    (module === 'inventory' || module === 'products') &&
    (entityType === 'product' || entityType === 'stock_adjustment')
  ) {
    if (action === 'DELETE') return { ok: true };
    return validateInventoryAdjustment(tenantPool, payload);
  }

  return { ok: true };
};

module.exports = {
  validateInventoryProtection,
  validateSalesInventory,
  validateInventoryAdjustment,
};
