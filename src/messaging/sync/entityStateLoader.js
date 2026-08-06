const { extractSourceUpdatedAt } = require('./conflictDetector');

const loadSalesOrderState = async (tenantPool, entityId, payload) => {
  const orderPayload = payload?.order || payload;
  const clientOrderId =
    orderPayload?.client_order_id ||
    orderPayload?.clientOrderId ||
    payload?.clientId ||
    null;

  if (clientOrderId) {
    const result = await tenantPool.query(
      `SELECT id,
              updated_at,
              is_deleted,
              client_order_id,
              order_status,
              payment_mode,
              total_paid,
              total_price
       FROM orders
       WHERE client_order_id = $1
       LIMIT 1`,
      [clientOrderId]
    );
    if (result.rows[0]) return result.rows[0];
  }

  if (entityId) {
    const result = await tenantPool.query(
      `SELECT id,
              updated_at,
              is_deleted,
              client_order_id,
              order_status,
              payment_mode,
              total_paid,
              total_price
       FROM orders
       WHERE id = $1
       LIMIT 1`,
      [entityId]
    );
    return result.rows[0] || null;
  }

  return null;
};

const loadProductState = async (tenantPool, entityId, payload) => {
  const productId =
    entityId ||
    payload?.product_id ||
    payload?.productId ||
    payload?.id ||
    null;
  if (!productId) return null;

  const result = await tenantPool.query(
    `SELECT id,
            updated_at,
            is_deleted,
            stock_quantity,
            name
     FROM products
     WHERE id = $1
     LIMIT 1`,
    [productId]
  );
  return result.rows[0] || null;
};

const loadServerEntityState = async ({ tenantPool, module, entityType, entityId, payload }) => {
  if (module === 'sales' && entityType === 'order') {
    return loadSalesOrderState(tenantPool, entityId, payload);
  }
  if (
    (module === 'inventory' || module === 'products') &&
    (entityType === 'product' || entityType === 'stock_adjustment')
  ) {
    return loadProductState(tenantPool, entityId, payload);
  }
  return null;
};

const extractServerUpdatedAt = (serverRow) =>
  extractSourceUpdatedAt(serverRow || {});

const extractServerVersion = (serverRow) => {
  const raw = serverRow?.sync_version ?? serverRow?.syncVersion ?? serverRow?.version;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

module.exports = {
  loadServerEntityState,
  loadSalesOrderState,
  loadProductState,
  extractServerUpdatedAt,
  extractServerVersion,
};
