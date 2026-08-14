const batchFailure = (message) => {
  const error = new Error(message);
  error.code = 'CANONICAL_INVENTORY_PROJECTION_FAILED';
  return error;
};

const toMilli = (quantity) => Math.max(0, Math.round(Number(quantity || 0) * 1000));

const insertAllocation = async (client, movement, branchId, seq, allocation) => {
  await client.query(
    `INSERT INTO pos_inventory_batch_allocations(
       movement_id,allocation_seq,order_id,order_item_id,product_id,branch_id,batch_id,
       quantity_milli,allocation_kind,source_movement_type
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      movement.movementId,
      seq,
      movement.orderId,
      movement.orderItemId,
      movement.productId,
      branchId,
      allocation.batchId || null,
      allocation.quantityMilli,
      allocation.kind,
      movement.movementType,
    ]
  );
};

const applySaleIssue = async (client, movement, branchId) => {
  let remainingMilli = Math.abs(movement.quantityDeltaMilli);
  const batches = await client.query(
    `SELECT id,quantity,quantity_remaining
     FROM batches
     WHERE product_id=$1
       AND branch_id=$2
       AND is_deleted=FALSE
       AND COALESCE(quantity_remaining,quantity) > 0
       AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
     ORDER BY created_at ASC,id ASC
     FOR UPDATE`,
    [movement.productId, branchId]
  );

  let seq = 1;
  let batchAllocatedMilli = 0;
  for (const batch of batches.rows) {
    if (remainingMilli <= 0) break;
    const availableMilli = toMilli(batch.quantity_remaining ?? batch.quantity);
    if (availableMilli <= 0) continue;
    const quantityMilli = Math.min(availableMilli, remainingMilli);
    await client.query(
      `UPDATE batches
       SET quantity_remaining=ROUND(COALESCE(quantity_remaining,quantity) - ($1::numeric / 1000.0), 3),
           updated_at=NOW()
       WHERE id=$2 AND product_id=$3 AND branch_id=$4`,
      [quantityMilli, batch.id, movement.productId, branchId]
    );
    await insertAllocation(client, movement, branchId, seq, {
      batchId: batch.id,
      quantityMilli,
      kind: 'batch',
    });
    seq += 1;
    batchAllocatedMilli += quantityMilli;
    remainingMilli -= quantityMilli;
  }

  if (remainingMilli > 0) {
    await insertAllocation(client, movement, branchId, seq, {
      batchId: null,
      quantityMilli: remainingMilli,
      kind: 'unallocated',
    });
  }

  return {
    batch_allocated_milli: batchAllocatedMilli,
    unallocated_milli: remainingMilli,
  };
};

const applySaleReturn = async (client, movement, branchId) => {
  let remainingMilli = movement.quantityDeltaMilli;
  const outstanding = await client.query(
    `SELECT batch_id,allocation_kind,
            SUM(CASE WHEN source_movement_type='sale_issue' THEN quantity_milli ELSE -quantity_milli END)::bigint AS outstanding_milli,
            MIN(created_at) AS first_allocated_at,
            MIN(allocation_seq) AS first_allocation_seq
     FROM pos_inventory_batch_allocations
     WHERE order_id=$1 AND order_item_id=$2 AND product_id=$3 AND branch_id=$4
     GROUP BY batch_id,allocation_kind
     HAVING SUM(CASE WHEN source_movement_type='sale_issue' THEN quantity_milli ELSE -quantity_milli END) > 0
     ORDER BY first_allocated_at ASC,first_allocation_seq ASC`,
    [movement.orderId, movement.orderItemId, movement.productId, branchId]
  );

  let seq = 1;
  let batchRestoredMilli = 0;
  let unallocatedRestoredMilli = 0;
  for (const allocation of outstanding.rows) {
    if (remainingMilli <= 0) break;
    const availableMilli = Number(allocation.outstanding_milli || 0);
    if (!Number.isSafeInteger(availableMilli) || availableMilli <= 0) continue;
    const quantityMilli = Math.min(availableMilli, remainingMilli);

    if (allocation.allocation_kind === 'batch') {
      const restored = await client.query(
        `UPDATE batches
         SET quantity_remaining=ROUND(COALESCE(quantity_remaining,quantity) + ($1::numeric / 1000.0), 3),
             updated_at=NOW()
         WHERE id=$2 AND product_id=$3 AND branch_id=$4 AND is_deleted=FALSE
         RETURNING id`,
        [quantityMilli, allocation.batch_id, movement.productId, branchId]
      );
      if (restored.rowCount !== 1) {
        throw batchFailure(`original Central batch ${allocation.batch_id} is unavailable for POS return restoration`);
      }
      batchRestoredMilli += quantityMilli;
    } else if (allocation.allocation_kind === 'unallocated') {
      unallocatedRestoredMilli += quantityMilli;
    } else {
      throw batchFailure(`unsupported POS batch allocation kind ${allocation.allocation_kind}`);
    }

    await insertAllocation(client, movement, branchId, seq, {
      batchId: allocation.batch_id || null,
      quantityMilli,
      kind: allocation.allocation_kind,
    });
    seq += 1;
    remainingMilli -= quantityMilli;
  }

  if (remainingMilli > 0) {
    throw batchFailure('POS sale return exceeds the original Central batch allocation');
  }

  return {
    batch_restored_milli: batchRestoredMilli,
    unallocated_restored_milli: unallocatedRestoredMilli,
  };
};

const applyPosInventoryBatchMovement = async (client, movement, inventoryDevice) => {
  if (!inventoryDevice?.branchId) throw batchFailure('trusted POS device branch is required for batch inventory projection');
  if (!movement.orderItemId) throw batchFailure('POS inventory order_item_id is required for batch inventory projection');

  const product = await client.query(
    `SELECT id,is_batch_enabled
     FROM products
     WHERE id=$1 AND is_deleted=FALSE
     FOR UPDATE`,
    [movement.productId]
  );
  if (product.rowCount !== 1) {
    throw batchFailure(`canonical Central product ${movement.productId} is missing for POS inventory movement`);
  }
  if (product.rows[0].is_batch_enabled !== true) {
    return { batch_applied: false, batch_enabled: false };
  }

  if (movement.movementType === 'sale_issue' && movement.quantityDeltaMilli < 0) {
    return { batch_applied: true, batch_enabled: true, ...(await applySaleIssue(client, movement, inventoryDevice.branchId)) };
  }
  if (movement.movementType === 'sale_return' && movement.quantityDeltaMilli > 0) {
    return { batch_applied: true, batch_enabled: true, ...(await applySaleReturn(client, movement, inventoryDevice.branchId)) };
  }
  throw batchFailure(`unsupported batch inventory movement ${movement.movementType}`);
};

module.exports = { applyPosInventoryBatchMovement };
