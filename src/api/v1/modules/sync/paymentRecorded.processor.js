const invalid = (message) => {
  const error = new Error(message);
  error.code = 'INVALID_PAYMENT_RECORDED_PAYLOAD';
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

const processPaymentRecorded = async (client, event) => {
  if (event.schema_version !== 1) throw invalid('unsupported payment.recorded schema_version');
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload must be an object');
  const payment = payload.payment;
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) throw invalid('payload.payment must be an object');

  const paymentId = requiredString(payment.id, 'payment.id');
  if (event.aggregate_type !== 'payment' || event.aggregate_id !== paymentId) {
    throw invalid('payment aggregate must match payload.payment.id');
  }

  const orderId = requiredString(payment.order_id, 'payment.order_id');
  const sale = await client.query('SELECT 1 FROM pos_sales WHERE order_id=$1 LIMIT 1', [orderId]);
  if (sale.rowCount === 0) {
    return { payment_id: paymentId, order_id: orderId, deferred: true, reason: 'sale_projection_missing' };
  }

  await client.query(
    `INSERT INTO pos_sale_payments(
       payment_id,order_id,client_payment_id,mode,direction,amount_minor,currency,status,
       reference,provider,provider_payload_json,recorded_by,source_created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
     ON CONFLICT(payment_id) DO UPDATE SET
       order_id=EXCLUDED.order_id,
       client_payment_id=EXCLUDED.client_payment_id,
       mode=EXCLUDED.mode,
       direction=EXCLUDED.direction,
       amount_minor=EXCLUDED.amount_minor,
       currency=EXCLUDED.currency,
       status=EXCLUDED.status,
       reference=EXCLUDED.reference,
       provider=EXCLUDED.provider,
       provider_payload_json=EXCLUDED.provider_payload_json,
       recorded_by=EXCLUDED.recorded_by,
       source_created_at=EXCLUDED.source_created_at`,
    [
      paymentId,
      orderId,
      requiredString(payment.client_payment_id, 'payment.client_payment_id'),
      requiredString(payment.mode, 'payment.mode'),
      requiredString(payment.direction, 'payment.direction'),
      integer(payment.amount_minor, 'payment.amount_minor'),
      requiredString(payment.currency, 'payment.currency'),
      requiredString(payment.status, 'payment.status'),
      payment.reference || null,
      payment.provider || null,
      JSON.stringify(payment.provider_payload ?? null),
      payment.recorded_by || null,
      payment.created_at || null,
    ]
  );

  return { payment_id: paymentId, order_id: orderId, status: payment.status };
};

module.exports = { processPaymentRecorded };
