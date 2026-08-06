const { loadSalesOrderState } = require('./entityStateLoader');

const getOrderPayload = (payload = {}) => payload?.order || payload;

const checkDuplicateSale = async (tenantPool, payload = {}) => {
  const order = getOrderPayload(payload);
  const clientOrderId =
    order?.client_order_id || order?.clientOrderId || payload?.clientId || null;
  if (!clientOrderId) return null;

  const existing = await loadSalesOrderState(tenantPool, null, { ...payload, client_order_id: clientOrderId });
  if (!existing) return null;

  return {
    duplicate: true,
    serverEntityId: existing.id,
    clientOrderId,
    serverRow: existing,
  };
};

module.exports = {
  checkDuplicateSale,
};
