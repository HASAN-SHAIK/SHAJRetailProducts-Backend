const asObject = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`${name} must be an object`);
    error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
    throw error;
  }
  return value;
};

const asArray = (value, name) => {
  if (!Array.isArray(value)) {
    const error = new Error(`${name} must be an array`);
    error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
    throw error;
  }
  return value;
};

const requiredString = (value, name) => {
  const result = String(value || '').trim();
  if (!result) {
    const error = new Error(`${name} is required`);
    error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
    throw error;
  }
  return result;
};

const integer = (value, name) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    const error = new Error(`${name} must be an integer`);
    error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
    throw error;
  }
  return result;
};

const processSaleCompleted = async (client, event) => {
  const payload = asObject(event.payload, 'payload');
  const order = asObject(payload.order, 'payload.order');
  const receipt = asObject(payload.receipt, 'payload.receipt');
  const payments = asArray(payload.payments, 'payload.payments');
  const inventory = asArray(payload.inventory_movements, 'payload.inventory_movements');
  const items = asArray(order.items, 'payload.order.items');

  const orderId = requiredString(order.id, 'order.id');
  if (orderId !== event.aggregate_id) {
    const error = new Error('aggregate_id must match payload.order.id');
    error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
    throw error;
  }

  await client.query(
    `INSERT INTO pos_sales(
       order_id,client_order_id,store_id,terminal_id,customer_id,status,currency,
       subtotal_minor,discount_minor,tax_minor,total_minor,notes,version,completed_at,
       source_created_at,source_updated_at,source_event_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT(order_id) DO UPDATE SET
       status=EXCLUDED.status,
       subtotal_minor=EXCLUDED.subtotal_minor,
       discount_minor=EXCLUDED.discount_minor,
       tax_minor=EXCLUDED.tax_minor,
       total_minor=EXCLUDED.total_minor,
       notes=EXCLUDED.notes,
       version=EXCLUDED.version,
       completed_at=EXCLUDED.completed_at,
       source_updated_at=EXCLUDED.source_updated_at,
       updated_at=NOW()
     WHERE pos_sales.version <= EXCLUDED.version`,
    [
      orderId,
      requiredString(order.client_order_id, 'order.client_order_id'),
      requiredString(order.store_id, 'order.store_id'),
      order.terminal_id || null,
      order.customer_id || null,
      requiredString(order.status, 'order.status'),
      requiredString(order.currency, 'order.currency'),
      integer(order.subtotal_minor, 'order.subtotal_minor'),
      integer(order.discount_minor, 'order.discount_minor'),
      integer(order.tax_minor, 'order.tax_minor'),
      integer(order.total_minor, 'order.total_minor'),
      order.notes || null,
      integer(order.version, 'order.version'),
      order.completed_at || null,
      order.created_at || null,
      order.updated_at || null,
      event.event_id,
    ]
  );

  for (const item of items) {
    await client.query(
      `INSERT INTO pos_sale_items(
         item_id,order_id,line_no,product_id,sku,product_name,barcode,quantity_milli,
         unit_price_minor,discount_minor,tax_minor,line_total_minor,tax_code
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(item_id) DO NOTHING`,
      [
        requiredString(item.id, 'item.id'), orderId, integer(item.line_no, 'item.line_no'),
        requiredString(item.product_id, 'item.product_id'), item.sku || null,
        requiredString(item.product_name, 'item.product_name'), item.barcode || null,
        integer(item.quantity_milli, 'item.quantity_milli'), integer(item.unit_price_minor, 'item.unit_price_minor'),
        integer(item.discount_minor, 'item.discount_minor'), integer(item.tax_minor, 'item.tax_minor'),
        integer(item.line_total_minor, 'item.line_total_minor'), item.tax_code || null,
      ]
    );
  }

  for (const payment of payments) {
    await client.query(
      `INSERT INTO pos_sale_payments(
         payment_id,order_id,client_payment_id,mode,direction,amount_minor,currency,status,
         reference,provider,source_created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(payment_id) DO NOTHING`,
      [
        requiredString(payment.id, 'payment.id'), orderId,
        requiredString(payment.client_payment_id, 'payment.client_payment_id'),
        requiredString(payment.mode, 'payment.mode'), requiredString(payment.direction, 'payment.direction'),
        integer(payment.amount_minor, 'payment.amount_minor'), requiredString(payment.currency, 'payment.currency'),
        requiredString(payment.status, 'payment.status'), payment.reference || null, payment.provider || null,
        payment.created_at || null,
      ]
    );
  }

  await client.query(
    `INSERT INTO pos_sale_receipts(
       receipt_id,order_id,receipt_number,document_type,store_id,terminal_id,customer_id,currency,
       total_minor,paid_minor,balance_minor,snapshot_json,snapshot_sha256,issued_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
     ON CONFLICT(receipt_id) DO NOTHING`,
    [
      requiredString(receipt.id, 'receipt.id'), orderId,
      requiredString(receipt.receipt_number, 'receipt.receipt_number'),
      requiredString(receipt.document_type, 'receipt.document_type'),
      requiredString(receipt.store_id, 'receipt.store_id'), receipt.terminal_id || null, receipt.customer_id || null,
      requiredString(receipt.currency, 'receipt.currency'), integer(receipt.total_minor, 'receipt.total_minor'),
      integer(receipt.paid_minor, 'receipt.paid_minor'), integer(receipt.balance_minor, 'receipt.balance_minor'),
      JSON.stringify(receipt.snapshot ?? {}), requiredString(receipt.snapshot_sha256, 'receipt.snapshot_sha256'),
      requiredString(receipt.issued_at, 'receipt.issued_at'),
    ]
  );

  for (const movement of inventory) {
    await client.query(
      `INSERT INTO pos_inventory_movements(
         movement_id,order_id,store_id,product_id,movement_type,quantity_delta_milli,
         reference_type,reference_id,order_item_id,balance_after_milli,occurred_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(movement_id) DO NOTHING`,
      [
        requiredString(movement.id, 'movement.id'), orderId,
        requiredString(movement.store_id, 'movement.store_id'), requiredString(movement.product_id, 'movement.product_id'),
        requiredString(movement.movement_type, 'movement.movement_type'),
        integer(movement.quantity_delta_milli, 'movement.quantity_delta_milli'), movement.reference_type || null,
        movement.reference_id || null, movement.order_item_id || null,
        integer(movement.balance_after_milli, 'movement.balance_after_milli'),
        requiredString(movement.occurred_at, 'movement.occurred_at'),
      ]
    );
  }

  return {
    order_id: orderId,
    items: items.length,
    payments: payments.length,
    inventory_movements: inventory.length,
    receipt_id: receipt.id,
  };
};

const processPosEvent = async (client, event) => {
  if (event.event_type === 'sale.completed') {
    return processSaleCompleted(client, event);
  }
  return { ignored: true, reason: 'unsupported_event_type' };
};

module.exports = { processPosEvent, processSaleCompleted };
