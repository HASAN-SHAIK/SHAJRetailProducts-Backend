const { processOperationInline } = require('../messaging/sync/syncOperation.service');

const toMoney = (minor) => Number(minor || 0) / 100;
const toQuantity = (milli) => Number(milli || 0) / 1000;

const resolveReceiptCustomer = (payload = {}) => {
  const snapshot = payload?.receipt?.snapshot;
  return snapshot?.customer || snapshot?.Customer || null;
};

const centralOrderFromSaleEvent = (payload = {}) => {
  const order = payload.order || {};
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const captured = payments.filter((payment) =>
    String(payment?.status || '').toLowerCase() === 'captured' &&
    String(payment?.direction || 'in').toLowerCase() === 'in'
  );
  const firstPayment = captured[0];
  const customerSnapshot = resolveReceiptCustomer(payload);
  const rawCustomerId = order.customer_id;
  const numericCustomerId = /^\d+$/.test(String(rawCustomerId || '')) ? Number(rawCustomerId) : null;

  const items = Array.isArray(order.items) ? order.items : [];
  return {
    client_order_id: order.client_order_id || order.id,
    transaction_type: 'sale',
    branch_id: order.store_id,
    ...(numericCustomerId ? { customer_id: numericCustomerId } : {}),
    ...(!numericCustomerId && customerSnapshot?.name ? { customer_name: customerSnapshot.name } : {}),
    ...(!numericCustomerId && (customerSnapshot?.phone || customerSnapshot?.mobile)
      ? { customer_phone: customerSnapshot.phone || customerSnapshot.mobile }
      : {}),
    payment_mode: firstPayment?.mode || (captured.length ? 'cash' : 'credit'),
    client_created_at: order.created_at || payload?.receipt?.issued_at || new Date().toISOString(),
    billing_type: 'retail',
    is_gst_enabled: true,
    products: items.map((item) => ({
      product_id: Number(item.product_id),
      quantity: toQuantity(item.quantity_milli),
      selling_price: toMoney(item.unit_price_minor),
      discount_amount: toMoney(item.discount_minor),
      barcode: item.barcode || undefined,
    })),
    payments: captured.map((payment) => ({
      amount_paid: toMoney(payment.amount_minor),
      payment_mode: payment.mode,
      created_at: payment.created_at,
      reference: payment.reference || undefined,
    })),
    total_amount: toMoney(order.total_minor),
    source_pos_order_id: order.id,
  };
};

const ingestPosEvent = async ({ tenantPool, tenant, tenantId, deviceId, event }) => {
  if (!event || event.event_type !== 'sale.completed' || !event.event_id) {
    const error = new Error('Unsupported or invalid POS event.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const order = centralOrderFromSaleEvent(event.payload || {});
  if (!order.branch_id || !Array.isArray(order.products) || order.products.length === 0) {
    const error = new Error('Completed sale event is missing branch/items.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (order.products.some((item) => !Number.isFinite(item.product_id) || item.product_id <= 0)) {
    const error = new Error('Completed sale contains a product id that is not mapped to the central catalog.');
    error.code = 'PRODUCT_MAPPING_REQUIRED';
    error.retryable = false;
    throw error;
  }

  const operation = {
    clientId: event.event_id,
    module: 'sales',
    entityType: 'order',
    entityId: null,
    action: 'CREATE',
    payload: {
      order,
      pos_event: {
        event_id: event.event_id,
        aggregate_id: event.aggregate_id,
        aggregate_version: event.aggregate_version,
        device_id: deviceId,
      },
    },
  };
  return processOperationInline(tenantPool, operation, {
    tenantId,
    tenantDatabase: tenant?.database_name,
    userId: null,
  });
};

const encodeCursor = (entry) => Buffer.from(JSON.stringify(entry), 'utf8').toString('base64url');
const decodeCursor = (value) => {
  if (!value) return { t: '1970-01-01T00:00:00.000Z', k: '' };
  try {
    const decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return { t: decoded.t || '1970-01-01T00:00:00.000Z', k: decoded.k || '' };
  } catch {
    const error = new Error('Invalid change-feed cursor.');
    error.code = 'INVALID_CURSOR';
    throw error;
  }
};

const iso = (value) => new Date(value || 0).toISOString();
const versionFrom = (value) => Math.max(1, Math.floor(new Date(value || Date.now()).getTime()));
const recordKey = (record) => `${iso(record.updated_at)}|${record.source}|${String(record.id)}`;
const categoryIdentity = (value) => {
  const name = String(value || '').trim();
  return name ? { id: encodeURIComponent(name), name } : null;
};

const loadChangeRecords = async (pool, cursor, fetchLimit) => {
  const since = new Date(cursor.t);
  if (Number.isNaN(since.getTime())) throw Object.assign(new Error('Invalid cursor timestamp.'), { code: 'INVALID_CURSOR' });

  const [products, customers] = await Promise.all([
    pool.query(
      `SELECT id, name, barcode, selling_price, category, stock_quantity, branch_id,
              COALESCE(is_deleted, FALSE) AS is_deleted,
              COALESCE(updated_at, created_at, NOW()) AS updated_at
       FROM products
       WHERE COALESCE(updated_at, created_at, NOW()) >= $1
       ORDER BY COALESCE(updated_at, created_at, NOW()), id
       LIMIT $2`, [since, fetchLimit]
    ),
    pool.query(
      `SELECT id, name, COALESCE(phone, mobile) AS phone,
              COALESCE(credit_limit, 0) AS credit_limit,
              COALESCE(current_balance, 0) AS current_balance,
              COALESCE(updated_at, created_at, NOW()) AS updated_at
       FROM customers
       WHERE COALESCE(updated_at, created_at, NOW()) >= $1
       ORDER BY COALESCE(updated_at, created_at, NOW()), id
       LIMIT $2`, [since, fetchLimit]
    ),
  ]);

  const records = [
    ...products.rows.map((row) => ({ ...row, source: 'product' })),
    ...customers.rows.map((row) => ({ ...row, source: 'customer' })),
  ];
  return records
    .filter((record) => recordKey(record) > (cursor.k || ''))
    .sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
};

const loadCategorySnapshot = async (pool, branchId = null) => {
  const result = await pool.query(
    `SELECT TRIM(category) AS name
     FROM products
     WHERE COALESCE(is_deleted, FALSE) = FALSE
       AND category IS NOT NULL AND TRIM(category) <> ''
       AND ($1::text IS NULL OR branch_id IS NULL OR branch_id::text = $1)
     GROUP BY TRIM(category)
     ORDER BY name ASC`,
    [branchId]
  );
  return result.rows.map((row) => categoryIdentity(row.name)).filter(Boolean);
};

const productMessages = (row, branchId = null) => {
  const updatedAt = iso(row.updated_at);
  const version = versionFrom(row.updated_at);
  const prefix = `product:${row.id}:${updatedAt}`;
  const appliesToBranch = !branchId || !row.branch_id || String(row.branch_id) === String(branchId);
  if (!appliesToBranch) {
    return [{
      id: `${prefix}:remove`, type: 'catalog.product.remove', schema_version: 1, source: 'central',
      payload: { id: String(row.id), version, source_updated_at: updatedAt },
    }];
  }

  const category = categoryIdentity(row.category);
  const messages = [];
  if (category) messages.push({
    id: `${prefix}:category`, type: 'catalog.category.upsert', schema_version: 1, source: 'central',
    payload: {
      id: category.id, parent_id: null, name: category.name, code: null,
      sort_order: 0, is_active: true, version, source_updated_at: updatedAt,
    },
  });
  messages.push({
    id: `${prefix}:product`, type: 'catalog.product.upsert', schema_version: 1, source: 'central',
    payload: {
      id: String(row.id), category_id: category?.id || null, sku: null, name: row.name,
      description: null, unit_of_measure: 'unit', tax_code: null,
      is_active: !row.is_deleted, allow_manual_price: true, track_inventory: true,
      version, source_updated_at: updatedAt,
    },
  });
  if (row.barcode) messages.push({
    id: `${prefix}:barcode`, type: 'catalog.barcode.upsert', schema_version: 1, source: 'central',
    payload: { barcode: String(row.barcode), product_id: String(row.id), barcode_type: 'EAN', is_primary: true },
  });
  if (row.selling_price !== null && row.selling_price !== undefined) messages.push({
    id: `${prefix}:price`, type: 'catalog.price.upsert', schema_version: 1, source: 'central',
    payload: {
      id: `product:${row.id}:store:${row.branch_id || 'default'}`,
      product_id: String(row.id), store_id: row.branch_id ? String(row.branch_id) : null,
      price_list_id: null, currency: 'INR', amount_minor: Math.round(Number(row.selling_price || 0) * 100),
      tax_inclusive: true, valid_from: null, valid_to: null, priority: row.branch_id ? 100 : 0,
      version, source_updated_at: updatedAt,
    },
  });
  return messages;
};

const categorySnapshotMessage = (categories, trigger) => {
  const updatedAt = iso(trigger.updated_at);
  const version = versionFrom(trigger.updated_at);
  return {
    id: `catalog-categories:${Buffer.from(recordKey(trigger), 'utf8').toString('base64url')}`,
    type: 'catalog.categories.snapshot', schema_version: 1, source: 'central',
    payload: { categories, version, source_updated_at: updatedAt },
  };
};

const customerMessages = (row) => {
  const updatedAt = iso(row.updated_at);
  return [{
    id: `customer:${row.id}:${updatedAt}`, type: 'customer.upsert', schema_version: 1, source: 'central',
    payload: {
      id: String(row.id), customer_code: null, name: row.name || 'Customer', phone: row.phone || null,
      email: null, tax_id: null, credit_limit_minor: Math.round(Number(row.credit_limit || 0) * 100),
      outstanding_minor: Math.round(Number(row.current_balance || 0) * 100), currency: 'INR', status: 'active',
      source_updated_at: updatedAt,
    },
  }];
};

const getPosChanges = async ({ tenantPool, cursorValue, limit = 100, branchId = null }) => {
  const cursor = decodeCursor(cursorValue);
  const entityLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
  const records = await loadChangeRecords(tenantPool, cursor, Math.max(entityLimit * 3, 100));
  const selected = records.slice(0, entityLimit);
  const changes = selected.flatMap((record) => record.source === 'product' ? productMessages(record, branchId) : customerMessages(record));
  const selectedProducts = selected.filter((record) => record.source === 'product');
  if (selectedProducts.length > 0) {
    const categories = await loadCategorySnapshot(tenantPool, branchId);
    const trigger = selectedProducts[selectedProducts.length - 1];
    changes.push(categorySnapshotMessage(categories, trigger));
  }
  const last = selected[selected.length - 1];
  const nextCursor = last ? encodeCursor({ t: iso(last.updated_at), k: recordKey(last) }) : (cursorValue || encodeCursor(cursor));
  return { cursor: nextCursor, has_more: records.length > selected.length, changes };
};

module.exports = { ingestPosEvent, getPosChanges, centralOrderFromSaleEvent };
