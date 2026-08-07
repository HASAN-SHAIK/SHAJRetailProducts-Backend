const invalid = (message) => {
  const error = new Error(message);
  error.code = 'INVALID_RECEIPT_ISSUED_PAYLOAD';
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

const processReceiptIssued = async (client, event) => {
  if (event.schema_version !== 1) throw invalid('unsupported receipt.issued schema_version');
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload must be an object');
  const receipt = payload.receipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw invalid('payload.receipt must be an object');

  const receiptId = requiredString(receipt.id, 'receipt.id');
  if (event.aggregate_type !== 'receipt' || event.aggregate_id !== receiptId) {
    throw invalid('receipt aggregate must match payload.receipt.id');
  }

  const orderId = requiredString(receipt.order_id, 'receipt.order_id');
  await client.query(
    `INSERT INTO pos_sale_receipts(
       receipt_id,order_id,receipt_number,document_type,store_id,terminal_id,customer_id,currency,
       total_minor,paid_minor,balance_minor,snapshot_json,snapshot_sha256,issued_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
     ON CONFLICT(receipt_id) DO UPDATE SET
       order_id=EXCLUDED.order_id,
       receipt_number=EXCLUDED.receipt_number,
       document_type=EXCLUDED.document_type,
       store_id=EXCLUDED.store_id,
       terminal_id=EXCLUDED.terminal_id,
       customer_id=EXCLUDED.customer_id,
       currency=EXCLUDED.currency,
       total_minor=EXCLUDED.total_minor,
       paid_minor=EXCLUDED.paid_minor,
       balance_minor=EXCLUDED.balance_minor,
       snapshot_json=EXCLUDED.snapshot_json,
       snapshot_sha256=EXCLUDED.snapshot_sha256,
       issued_at=EXCLUDED.issued_at`,
    [
      receiptId,
      orderId,
      requiredString(receipt.receipt_number, 'receipt.receipt_number'),
      requiredString(receipt.document_type, 'receipt.document_type'),
      requiredString(receipt.store_id, 'receipt.store_id'),
      receipt.terminal_id || null,
      receipt.customer_id || null,
      requiredString(receipt.currency, 'receipt.currency'),
      integer(receipt.total_minor, 'receipt.total_minor'),
      integer(receipt.paid_minor, 'receipt.paid_minor'),
      integer(receipt.balance_minor, 'receipt.balance_minor'),
      JSON.stringify(receipt.snapshot ?? {}),
      requiredString(receipt.snapshot_sha256, 'receipt.snapshot_sha256'),
      requiredString(receipt.issued_at, 'receipt.issued_at'),
    ]
  );

  return { receipt_id: receiptId, order_id: orderId, receipt_number: receipt.receipt_number };
};

module.exports = { processReceiptIssued };
