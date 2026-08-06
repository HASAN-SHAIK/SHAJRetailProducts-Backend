const { syncOfflineOrders } = require('../../../controllers/orderController');

const invokeController = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400) {
          const message = payload?.error || payload?.message || 'Sync handler failed';
          const error = new Error(message);
          error.details = payload;
          reject(error);
          return;
        }
        resolve(payload);
      },
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });

const applySalesOrderOperation = async ({ tenantPool, userId, payload, action }) => {
  const orderPayload = payload?.order || payload;
  if (!orderPayload || typeof orderPayload !== 'object') {
    const error = new Error('Sales order payload is required.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (action === 'DELETE') {
    const error = new Error('Sales order DELETE sync is not supported via queue.');
    error.code = 'UNSUPPORTED_ACTION';
    error.retryable = false;
    throw error;
  }

  const clientOrderId =
    orderPayload.client_order_id || orderPayload.clientOrderId || payload?.clientId || null;
  const normalizedOrder = {
    ...orderPayload,
    client_order_id: clientOrderId,
  };

  const response = await invokeController(syncOfflineOrders, {
    body: { orders: [normalizedOrder] },
    tenantPool,
    user: { user_id: userId },
  });

  const result = Array.isArray(response?.results) ? response.results[0] : null;
  if (!result) {
    throw new Error('Sales order sync returned no result.');
  }

  if (result.status === 'failed') {
    const message = result.errors?.[0]?.message || 'Sales order sync failed.';
    const error = new Error(message);
    error.code = result.errors?.[0]?.code || 'SYNC_FAILED';
    error.retryable = error.code !== 'VALIDATION_ERROR';
    throw error;
  }

  if (result.status === 'duplicate') {
    return {
      duplicate: true,
      entityId: result.order_id,
      result,
    };
  }

  return {
    duplicate: false,
    entityId: result.order_id,
    result,
  };
};

module.exports = {
  applySalesOrderOperation,
};
