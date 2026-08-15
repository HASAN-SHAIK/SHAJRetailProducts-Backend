const invalid = (message) => {
  const error = new Error(message);
  error.code = 'INVALID_SALE_RETURNED_PAYLOAD';
  return error;
};

const requiredString = (value, name) => {
  const result = String(value || '').trim();
  if (!result) throw invalid(`${name} is required`);
  return result;
};

const integer = (value, name) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw invalid(`${name} must be a positive integer`);
  return result;
};

const processSaleReturned = async (client, event) => {
  if (event.schema_version !== 1) throw invalid('unsupported sale.returned schema_version');
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload must be an object');
  const order = payload.order;
  if (!order || typeof order !== 'object' || Array.isArray(order)) throw invalid('payload.order must be an object');

  const orderId = requiredString(order.id, 'order.id');
  const sourceVersion = integer(order.version, 'order.version');
  const approvedByUserID = requiredString(payload.approved_by_user_id, 'payload.approved_by_user_id');
  const approvalReason = requiredString(payload.approval_reason, 'payload.approval_reason');
  if (event.aggregate_type !== 'sales_order' || event.aggregate_id !== orderId) {
    throw invalid('sale.returned aggregate must match payload.order.id');
  }
  if (integer(event.aggregate_version, 'aggregate_version') !== sourceVersion) {
    throw invalid('aggregate_version must match order.version');
  }
  if (String(order.status || '').trim().toLowerCase() !== 'returned') {
    throw invalid('order.status must be returned');
  }

  const canonical = await client.query(
    `UPDATE orders SET
       order_status='returned',
       total_paid=0,
       returned_amount=total_price,
       source_event_id=$2,
       source_version=$3,
       source_refund_approved_by_user_id=$4,
       source_refund_reason=$5,
       source_returned_at=COALESCE($6::timestamptz,NOW()),
       updated_at=COALESCE($6::timestamptz,NOW())
     WHERE source_channel='pos' AND source_order_id=$1
       AND COALESCE(source_version,0) <= $3
     RETURNING id,source_version`,
    [
      orderId,
      event.event_id,
      sourceVersion,
      approvedByUserID,
      approvalReason,
      order.updated_at || null,
    ]
  );

  let centralOrderId = null;
  let applied = canonical.rowCount > 0;
  if (applied) {
    centralOrderId = canonical.rows[0].id;
  } else {
    const existing = await client.query(
      `SELECT id,source_version FROM orders WHERE source_channel='pos' AND source_order_id=$1 LIMIT 1`,
      [orderId]
    );
    if (existing.rowCount === 0) {
      const error = new Error('sale.returned requires an existing canonical POS sale');
      error.code = 'SALE_RETURNED_PARENT_MISSING';
      throw error;
    }
    centralOrderId = existing.rows[0].id;
    applied = false;
  }

  await client.query(
    `UPDATE pos_sales SET status='returned',version=$2,source_updated_at=$3,updated_at=NOW()
     WHERE order_id=$1 AND version <= $2`,
    [orderId, sourceVersion, order.updated_at || null]
  );

  return { order_id: orderId, central_order_id: centralOrderId, canonical_applied: applied, status: 'returned' };
};

module.exports = { processSaleReturned };