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

const optionalString = (value) => {
  const result = String(value ?? '').trim();
  return result || null;
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

const optionalInteger = (value, name) => {
  if (value === null || value === undefined || value === '') return null;
  return integer(value, name);
};

const centralIntegerId = (value) => {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const canonicalOrderStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'confirmed' || normalized === 'completed') return 'completed';
  return normalized || 'pending';
};

const projectCanonicalOrder = async (client, event, order, receipt, items, actor) => {
  const sourceOrderId = requiredString(order.id, 'order.id');
  const sourceVersion = integer(order.version, 'order.version');
  const customerId = centralIntegerId(order.customer_id);
  const actorUserId = optionalString(actor?.user_id);
  const createdByUserId = optionalString(order.created_by_user_id) || actorUserId;
  const completedByUserId = optionalString(order.completed_by_user_id) || actorUserId;

  const upsert = await client.query(
    `INSERT INTO orders(
       client_order_id,customer_id,total_price,total_paid,order_status,transaction_type,billing_type,
       created_at,updated_at,is_deleted,source_channel,source_order_id,source_store_id,source_terminal_id,
       source_customer_id,source_event_id,source_version,currency,subtotal_minor,discount_minor,tax_minor,
       total_minor,completed_at,notes,source_created_by_user_id,source_completed_by_user_id
     ) VALUES(
       $1,$2,($3::numeric / 100.0),($4::numeric / 100.0),$5,'sale','retail',
       COALESCE($6::timestamptz,NOW()),COALESCE($7::timestamptz,NOW()),FALSE,'pos',$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18,$19::timestamptz,$20,$21,$22
     )
     ON CONFLICT(source_channel,source_order_id) WHERE source_channel IS NOT NULL AND source_order_id IS NOT NULL
     DO UPDATE SET
       client_order_id=EXCLUDED.client_order_id,
       customer_id=COALESCE(EXCLUDED.customer_id,orders.customer_id),
       total_price=EXCLUDED.total_price,
       total_paid=EXCLUDED.total_paid,
       order_status=EXCLUDED.order_status,
       updated_at=EXCLUDED.updated_at,
       source_store_id=EXCLUDED.source_store_id,
       source_terminal_id=EXCLUDED.source_terminal_id,
       source_customer_id=EXCLUDED.source_customer_id,
       source_event_id=EXCLUDED.source_event_id,
       source_version=EXCLUDED.source_version,
       currency=EXCLUDED.currency,
       subtotal_minor=EXCLUDED.subtotal_minor,
       discount_minor=EXCLUDED.discount_minor,
       tax_minor=EXCLUDED.tax_minor,
       total_minor=EXCLUDED.total_minor,
       completed_at=EXCLUDED.completed_at,
       notes=EXCLUDED.notes,
       source_created_by_user_id=COALESCE(EXCLUDED.source_created_by_user_id,orders.source_created_by_user_id),
       source_completed_by_user_id=COALESCE(EXCLUDED.source_completed_by_user_id,orders.source_completed_by_user_id)
     WHERE COALESCE(orders.source_version,0) <= EXCLUDED.source_version
     RETURNING id,source_version`,
    [
      requiredString(order.client_order_id, 'order.client_order_id'),
      customerId,
      integer(order.total_minor, 'order.total_minor'),
      integer(receipt.paid_minor, 'receipt.paid_minor'),
      canonicalOrderStatus(order.status),
      order.created_at || null,
      order.updated_at || null,
      sourceOrderId,
      requiredString(order.store_id, 'order.store_id'),
      order.terminal_id || null,
      order.customer_id || null,
      event.event_id,
      sourceVersion,
      requiredString(order.currency, 'order.currency'),
      integer(order.subtotal_minor, 'order.subtotal_minor'),
      integer(order.discount_minor, 'order.discount_minor'),
      integer(order.tax_minor, 'order.tax_minor'),
      integer(order.total_minor, 'order.total_minor'),
      order.completed_at || null,
      order.notes || null,
      createdByUserId,
      completedByUserId,
    ]
  );

  let centralOrderId;
  let applied = true;
  if (upsert.rowCount > 0) {
    centralOrderId = upsert.rows[0].id;
  } else {
    const existing = await client.query(
      `SELECT id,source_version FROM orders WHERE source_channel='pos' AND source_order_id=$1 LIMIT 1`,
      [sourceOrderId]
    );
    if (existing.rowCount === 0) {
      const error = new Error('canonical POS order projection could not be resolved');
      error.code = 'CANONICAL_ORDER_PROJECTION_FAILED';
      throw error;
    }
    centralOrderId = existing.rows[0].id;
    applied = Number(existing.rows[0].source_version || 0) <= sourceVersion;
  }

  if (applied) {
    await client.query('DELETE FROM order_items WHERE order_id=$1', [centralOrderId]);

    for (const item of items) {
      const productId = centralIntegerId(item.product_id);
      await client.query(
        `INSERT INTO order_items(
           order_id,product_id,quantity,selling_price,discount_amount,gst_percent,
           source_item_id,source_product_id,line_no,sku_snapshot,product_name_snapshot,barcode_snapshot,
           quantity_milli,unit_price_minor,source_discount_minor,taxable_minor,gst_rate_bps,tax_minor,line_total_minor,tax_code,
           category_id_snapshot,category_name_snapshot
         ) VALUES(
           $1,$2,($3::numeric / 1000.0),($4::numeric / 100.0),($5::numeric / 100.0),COALESCE($13::numeric / 100.0,0),
           $6,$7,$8,$9,$10,$11,$3,$4,$5,$12,$13,$14,$15,$16,$17,$18
         )`,
        [
          centralOrderId,
          productId,
          integer(item.quantity_milli, 'item.quantity_milli'),
          integer(item.unit_price_minor, 'item.unit_price_minor'),
          integer(item.discount_minor, 'item.discount_minor'),
          requiredString(item.id, 'item.id'),
          requiredString(item.product_id, 'item.product_id'),
          integer(item.line_no, 'item.line_no'),
          item.sku || null,
          requiredString(item.product_name, 'item.product_name'),
          item.barcode || null,
          optionalInteger(item.taxable_minor, 'item.taxable_minor'),
          optionalInteger(item.gst_rate_bps, 'item.gst_rate_bps'),
          integer(item.tax_minor, 'item.tax_minor'),
          integer(item.line_total_minor, 'item.line_total_minor'),
          item.tax_code || null,
          optionalString(item.category_id),
          optionalString(item.category_name),
        ]
      );
    }
  }

  return { central_order_id: centralOrderId, canonical_applied: applied };
};

const processSaleCompleted = async (client, event) => {
  const payload = asObject(event.payload, 'payload');
  const order = asObject(payload.order, 'payload.order');
  const receipt = asObject(payload.receipt, 'payload.receipt');
  const payments = asArray(payload.payments, 'payload.payments');
  const inventory = asArray(payload.inventory_movements, 'payload.inventory_movements');
  const items = asArray(order.items, 'payload.order.items');
  const actor = payload.actor && typeof payload.actor === 'object' && !Array.isArray(payload.actor)
    ? payload.actor
    : null;

  const orderId = requiredString(order.id, 'order.id');
  if (orderId !== event.aggregate_id) {
    const error = new Error('aggregate_id must match payload.order.id');
    error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
    throw error;
  }

  // Canonical central model: every sale, regardless of channel, lands in orders/order_items.
  const canonical = await projectCanonicalOrder(client, event, order, receipt, items, actor);

  // Compatibility projection: keep the existing POS-specific tables during migration so
  // payment, receipt and inventory processors continue to function while they are moved
  // to canonical order references in a subsequent change.
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
         unit_price_minor,discount_minor,taxable_minor,gst_rate_bps,tax_minor,line_total_minor,tax_code,
         category_id_snapshot,category_name_snapshot
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT(item_id) DO NOTHING`,
      [
        requiredString(item.id, 'item.id'), orderId, integer(item.line_no, 'item.line_no'),
        requiredString(item.product_id, 'item.product_id'), item.sku || null,
        requiredString(item.product_name, 'item.product_name'), item.barcode || null,
        integer(item.quantity_milli, 'item.quantity_milli'), integer(item.unit_price_minor, 'item.unit_price_minor'),
        integer(item.discount_minor, 'item.discount_minor'), optionalInteger(item.taxable_minor, 'item.taxable_minor'),
        optionalInteger(item.gst_rate_bps, 'item.gst_rate_bps'), integer(item.tax_minor, 'item.tax_minor'),
        integer(item.line_total_minor, 'item.line_total_minor'), item.tax_code || null,
        optionalString(item.category_id), optionalString(item.category_name),
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
    central_order_id: canonical.central_order_id,
    canonical_applied: canonical.canonical_applied,
    cashier_user_id: optionalString(order.completed_by_user_id) || optionalString(actor?.user_id),
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
