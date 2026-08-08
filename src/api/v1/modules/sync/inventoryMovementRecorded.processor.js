const invalid = (message) => {
  const error = new Error(message);
  error.code = 'INVALID_INVENTORY_MOVEMENT_PAYLOAD';
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

const processInventoryMovementRecorded = async (client, event) => {
  if (event.schema_version !== 1) throw invalid('unsupported inventory.movement.recorded schema_version');
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload must be an object');
  const movement = payload.movement;
  if (!movement || typeof movement !== 'object' || Array.isArray(movement)) throw invalid('payload.movement must be an object');

  const movementId = requiredString(movement.id, 'movement.id');
  if (event.aggregate_type !== 'inventory_movement' || event.aggregate_id !== movementId) {
    throw invalid('inventory movement aggregate must match payload.movement.id');
  }

  const orderId = requiredString(movement.reference_id, 'movement.reference_id');
  if (movement.reference_type !== 'sale_order') throw invalid('sale inventory movement must reference sale_order');
  const sale = await client.query('SELECT 1 FROM pos_sales WHERE order_id=$1 LIMIT 1', [orderId]);
  if (sale.rowCount === 0) {
    return { movement_id: movementId, order_id: orderId, product_id: movement.product_id, deferred: true, reason: 'sale_projection_missing' };
  }

  await client.query(
    `INSERT INTO pos_inventory_movements(
       movement_id,order_id,store_id,product_id,movement_type,quantity_delta_milli,
       reference_type,reference_id,order_item_id,balance_after_milli,occurred_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(movement_id) DO UPDATE SET
       order_id=EXCLUDED.order_id,
       store_id=EXCLUDED.store_id,
       product_id=EXCLUDED.product_id,
       movement_type=EXCLUDED.movement_type,
       quantity_delta_milli=EXCLUDED.quantity_delta_milli,
       reference_type=EXCLUDED.reference_type,
       reference_id=EXCLUDED.reference_id,
       order_item_id=EXCLUDED.order_item_id,
       balance_after_milli=EXCLUDED.balance_after_milli,
       occurred_at=EXCLUDED.occurred_at`,
    [
      movementId,
      orderId,
      requiredString(movement.store_id, 'movement.store_id'),
      requiredString(movement.product_id, 'movement.product_id'),
      requiredString(movement.movement_type, 'movement.movement_type'),
      integer(movement.quantity_delta_milli, 'movement.quantity_delta_milli'),
      'sale_order',
      orderId,
      movement.order_item_id || null,
      integer(movement.balance_after_milli, 'movement.balance_after_milli'),
      requiredString(movement.occurred_at, 'movement.occurred_at'),
    ]
  );

  return { movement_id: movementId, order_id: orderId, product_id: movement.product_id };
};

module.exports = { processInventoryMovementRecorded };
