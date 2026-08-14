const { applyPosInventoryBatchMovement } = require('./posInventoryBatchAllocator');

const invalid = (message) => {
  const error = new Error(message);
  error.code = 'INVALID_INVENTORY_MOVEMENT_PAYLOAD';
  return error;
};

const canonicalFailure = (message) => {
  const error = new Error(message);
  error.code = 'CANONICAL_INVENTORY_PROJECTION_FAILED';
  return error;
};

const requiredString = (value, name) => {
  const result = String(value || '').trim();
  if (!result) throw invalid(`${name} is required`);
  return result;
};

const integer = (value, name) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw invalid(`${name} must be an integer`);
  return result;
};

const centralIntegerId = (value) => {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const timestampMillis = (value) => {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : NaN;
};

const stockAuditReason = (movementType) => {
  if (movementType === 'sale_issue') return 'sale';
  if (movementType === 'sale_return') return 'refund';
  return movementType;
};

const setPosInventoryStockAuditContext = async (client, movement, inventoryDevice) => {
  await client.query(
    `SELECT
       set_config('app.actor_user_id', '', true),
       set_config('app.actor_role', 'pos_device', true),
       set_config('app.actor_name', $1, true),
       set_config('app.stock_reason', $2, true),
       set_config('app.stock_source', 'pos_sync', true),
       set_config('app.stock_reference', $3, true)`,
    [String(inventoryDevice?.deviceId || ''), stockAuditReason(movement.movementType), movement.movementId]
  );
};

const sameExistingMovement = (row, movement) =>
  String(row.order_id) === movement.orderId &&
  String(row.store_id) === movement.storeId &&
  String(row.product_id) === movement.productId &&
  String(row.movement_type) === movement.movementType &&
  Number(row.quantity_delta_milli) === movement.quantityDeltaMilli &&
  String(row.reference_type) === 'sale_order' &&
  String(row.reference_id) === movement.orderId &&
  String(row.order_item_id ?? '') === String(movement.orderItemId ?? '') &&
  Number(row.balance_after_milli) === movement.balanceAfterMilli &&
  timestampMillis(row.occurred_at) === timestampMillis(movement.occurredAt);

const processInventoryMovementRecorded = async (client, event, inventoryDevice = null) => {
  if (event.schema_version !== 1) throw invalid('unsupported inventory.movement.recorded schema_version');
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload must be an object');
  const source = payload.movement;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw invalid('payload.movement must be an object');

  const movementId = requiredString(source.id, 'movement.id');
  if (event.aggregate_type !== 'inventory_movement' || event.aggregate_id !== movementId) {
    throw invalid('inventory movement aggregate must match payload.movement.id');
  }
  if (source.reference_type !== 'sale_order') throw invalid('sale inventory movement must reference sale_order');

  const movement = {
    movementId,
    orderId: requiredString(source.reference_id, 'movement.reference_id'),
    storeId: requiredString(source.store_id, 'movement.store_id'),
    productId: requiredString(source.product_id, 'movement.product_id'),
    movementType: requiredString(source.movement_type, 'movement.movement_type'),
    quantityDeltaMilli: integer(source.quantity_delta_milli, 'movement.quantity_delta_milli'),
    orderItemId: source.order_item_id || null,
    balanceAfterMilli: integer(source.balance_after_milli, 'movement.balance_after_milli'),
    occurredAt: requiredString(source.occurred_at, 'movement.occurred_at'),
  };

  const inserted = await client.query(
    `INSERT INTO pos_inventory_movements(
       movement_id,order_id,store_id,product_id,movement_type,quantity_delta_milli,
       reference_type,reference_id,order_item_id,balance_after_milli,occurred_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(movement_id) DO NOTHING
     RETURNING movement_id`,
    [
      movement.movementId,
      movement.orderId,
      movement.storeId,
      movement.productId,
      movement.movementType,
      movement.quantityDeltaMilli,
      'sale_order',
      movement.orderId,
      movement.orderItemId,
      movement.balanceAfterMilli,
      movement.occurredAt,
    ]
  );

  const existing = await client.query(
    `SELECT movement_id,order_id,store_id,product_id,movement_type,quantity_delta_milli,
            reference_type,reference_id,order_item_id,balance_after_milli,occurred_at,canonical_applied_at
     FROM pos_inventory_movements
     WHERE movement_id=$1
     FOR UPDATE`,
    [movement.movementId]
  );
  if (existing.rowCount !== 1) throw canonicalFailure('inventory movement could not be resolved after insert');

  if (inserted.rowCount === 0 && !sameExistingMovement(existing.rows[0], movement)) {
    throw invalid('movement.id is already bound to different immutable inventory facts');
  }

  if (existing.rows[0].canonical_applied_at) {
    return {
      movement_id: movement.movementId,
      order_id: movement.orderId,
      product_id: movement.productId,
      canonical_applied: false,
      already_applied: true,
    };
  }

  const productId = centralIntegerId(movement.productId);
  if (!productId) {
    throw canonicalFailure(`POS product ${movement.productId} cannot be resolved to a canonical Central product`);
  }

  const batch = await applyPosInventoryBatchMovement(client, { ...movement, productId }, inventoryDevice);

  const claimed = await client.query(
    `UPDATE pos_inventory_movements
     SET canonical_applied_at=NOW()
     WHERE movement_id=$1 AND canonical_applied_at IS NULL
     RETURNING movement_id`,
    [movement.movementId]
  );
  if (claimed.rowCount === 0) {
    return {
      movement_id: movement.movementId,
      order_id: movement.orderId,
      product_id: movement.productId,
      canonical_applied: false,
      already_applied: true,
    };
  }

  await setPosInventoryStockAuditContext(client, movement, inventoryDevice);

  const stock = await client.query(
    `UPDATE products
     SET stock_quantity=COALESCE(stock_quantity,0) + ($1::numeric / 1000.0),
         updated_at=NOW()
     WHERE id=$2 AND is_deleted=FALSE
     RETURNING id,stock_quantity`,
    [movement.quantityDeltaMilli, productId]
  );
  if (stock.rowCount !== 1) {
    throw canonicalFailure(`canonical Central product ${productId} is missing for POS inventory movement`);
  }

  return {
    movement_id: movement.movementId,
    order_id: movement.orderId,
    product_id: movement.productId,
    canonical_applied: true,
    canonical_stock_quantity: stock.rows[0].stock_quantity,
    batch,
  };
};

module.exports = { processInventoryMovementRecorded };
