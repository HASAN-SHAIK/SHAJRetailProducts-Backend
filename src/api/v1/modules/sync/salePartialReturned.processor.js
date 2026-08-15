const invalid = (message) => {
  const error = new Error(message);
  error.code = 'INVALID_SALE_PARTIAL_RETURNED_PAYLOAD';
  return error;
};

const requiredString = (value, name) => {
  const result = String(value || '').trim();
  if (!result) throw invalid(`${name} is required`);
  return result;
};

const positiveInteger = (value, name) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw invalid(`${name} must be a positive integer`);
  return result;
};

const nonNegativeInteger = (value, name) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw invalid(`${name} must be a non-negative integer`);
  return result;
};

const sameReplay = async (client, existing, expected) => {
  if (
    existing.source_order_id !== expected.orderId ||
    Number(existing.source_version) !== expected.sourceVersion ||
    Number(existing.refund_minor) !== expected.refundMinor ||
    existing.approved_by_user_id !== expected.approvedByUserID ||
    existing.reason !== expected.reason
  ) {
    return false;
  }

  const rows = await client.query(
    `SELECT source_item_id,quantity_milli,refund_minor
       FROM pos_partial_return_items
      WHERE return_id=$1
      ORDER BY source_item_id`,
    [expected.returnId]
  );
  if (rows.rowCount !== expected.lines.length) return false;

  const wanted = new Map(expected.lines.map((line) => [line.orderItemId, line]));
  for (const row of rows.rows) {
    const line = wanted.get(row.source_item_id);
    if (!line || Number(row.quantity_milli) !== line.quantityMilli || Number(row.refund_minor) !== line.refundMinor) {
      return false;
    }
  }
  return true;
};

const processSalePartialReturned = async (client, event) => {
  if (event.schema_version !== 1) throw invalid('unsupported sale.partial_returned schema_version');
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload must be an object');
  const order = payload.order;
  if (!order || typeof order !== 'object' || Array.isArray(order)) throw invalid('payload.order must be an object');

  const orderId = requiredString(order.id, 'order.id');
  const sourceVersion = positiveInteger(order.version, 'order.version');
  const returnId = requiredString(payload.return_id, 'payload.return_id');
  const refundMinor = positiveInteger(payload.refund_minor, 'payload.refund_minor');
  const approvedByUserID = requiredString(payload.approved_by_user_id, 'payload.approved_by_user_id');
  const reason = requiredString(payload.approval_reason, 'payload.approval_reason');

  if (event.aggregate_type !== 'sales_order' || event.aggregate_id !== orderId) {
    throw invalid('sale.partial_returned aggregate must match payload.order.id');
  }
  if (positiveInteger(event.aggregate_version, 'aggregate_version') !== sourceVersion) {
    throw invalid('aggregate_version must match order.version');
  }
  const orderStatus = String(order.status || '').trim().toLowerCase();
  if (!['completed', 'returned'].includes(orderStatus)) {
    throw invalid('partial return order.status must be completed or returned');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw invalid('payload.lines must be a non-empty array');
  }

  const seen = new Set();
  let lineRefundTotal = 0;
  const lines = payload.lines.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw invalid(`payload.lines[${index}] must be an object`);
    const orderItemId = requiredString(line.order_item_id, `payload.lines[${index}].order_item_id`);
    if (seen.has(orderItemId)) throw invalid('payload.lines contains duplicate order_item_id');
    seen.add(orderItemId);
    const quantityMilli = positiveInteger(line.quantity_milli, `payload.lines[${index}].quantity_milli`);
    const lineRefundMinor = nonNegativeInteger(line.refund_minor, `payload.lines[${index}].refund_minor`);
    lineRefundTotal += lineRefundMinor;
    if (!Number.isSafeInteger(lineRefundTotal)) throw invalid('payload.lines refund total is too large');
    return { orderItemId, quantityMilli, refundMinor: lineRefundMinor };
  });
  if (lineRefundTotal !== refundMinor) throw invalid('payload.refund_minor must equal the sum of line refund_minor');

  const canonical = await client.query(
    `SELECT id,COALESCE(source_version,0) AS source_version
       FROM orders
      WHERE source_channel='pos' AND source_order_id=$1
      LIMIT 1`,
    [orderId]
  );
  if (canonical.rowCount === 0) {
    const error = new Error('sale.partial_returned requires an existing canonical POS sale');
    error.code = 'SALE_PARTIAL_RETURNED_PARENT_MISSING';
    throw error;
  }
  const centralOrderId = canonical.rows[0].id;

  const replay = await client.query(
    `SELECT source_order_id,source_version,refund_minor,approved_by_user_id,reason
       FROM pos_partial_returns WHERE return_id=$1`,
    [returnId]
  );
  if (replay.rowCount > 0) {
    const matches = await sameReplay(client, replay.rows[0], {
      orderId, sourceVersion, returnId, refundMinor, approvedByUserID, reason, lines,
    });
    if (!matches) throw invalid('return_id was already used with different partial-return facts');
    return {
      return_id: returnId,
      order_id: orderId,
      central_order_id: centralOrderId,
      canonical_applied: false,
      replayed: true,
      status: orderStatus,
    };
  }

  await client.query(
    `INSERT INTO pos_partial_returns(
       return_id,order_id,source_order_id,source_version,refund_minor,approved_by_user_id,reason,source_event_id,source_returned_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,
    [returnId, centralOrderId, orderId, sourceVersion, refundMinor, approvedByUserID, reason, event.event_id, payload.returned_at || order.updated_at || null]
  );

  for (const line of lines) {
    const updated = await client.query(
      `UPDATE order_items
          SET source_returned_quantity_milli=source_returned_quantity_milli+$3,
              source_refunded_minor=source_refunded_minor+$4
        WHERE order_id=$1 AND source_item_id=$2
          AND source_returned_quantity_milli+$3 <= quantity_milli
      RETURNING id`,
      [centralOrderId, line.orderItemId, line.quantityMilli, line.refundMinor]
    );
    if (updated.rowCount === 0) {
      throw invalid(`partial return item ${line.orderItemId} is missing or exceeds the sold quantity`);
    }
    await client.query(
      `INSERT INTO pos_partial_return_items(return_id,source_item_id,quantity_milli,refund_minor)
       VALUES($1,$2,$3,$4)`,
      [returnId, line.orderItemId, line.quantityMilli, line.refundMinor]
    );
  }

  await client.query(
    `UPDATE orders SET
       total_paid=GREATEST(0,total_paid-($2::numeric / 100.0)),
       returned_amount=LEAST(total_price,COALESCE(returned_amount,0)+($2::numeric / 100.0)),
       source_version=GREATEST(COALESCE(source_version,0),$3),
       source_event_id=CASE WHEN COALESCE(source_version,0) <= $3 THEN $4 ELSE source_event_id END,
       updated_at=GREATEST(updated_at,COALESCE($5::timestamptz,updated_at))
     WHERE id=$1`,
    [centralOrderId, refundMinor, sourceVersion, event.event_id, payload.returned_at || order.updated_at || null]
  );

  await client.query(
    `UPDATE pos_sales SET version=GREATEST(version,$2),source_updated_at=COALESCE($3::timestamptz,source_updated_at),updated_at=NOW()
     WHERE order_id=$1`,
    [orderId, sourceVersion, order.updated_at || null]
  );

  return {
    return_id: returnId,
    order_id: orderId,
    central_order_id: centralOrderId,
    canonical_applied: true,
    replayed: false,
    status: orderStatus,
  };
};

module.exports = { processSalePartialReturned };