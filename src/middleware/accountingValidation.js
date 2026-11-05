const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_RECEIPT_MODES = new Set(['cash', 'bank', 'online']);
const ALLOWED_PAYMENT_MODES = new Set(['cash', 'bank']);
const ALLOWED_PAYMENT_TYPES = new Set(['supplier', 'expense', 'drawings']);

const validateReceiptEntry = (req, res, next) => {
  const payload = req.body || {};
  const customerId = Number(payload.customer_id);
  const amount = Number(payload.amount);
  const rawMode = String(payload.payment_mode || payload.paymentMode || '').trim().toLowerCase();
  const mode = rawMode === 'upi' ? 'online' : rawMode;

  if (!Number.isFinite(customerId)) {
    return res.status(400).json({ success: false, message: 'customer_id is required.' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be > 0.' });
  }
  if (!ALLOWED_RECEIPT_MODES.has(mode)) {
    return res.status(400).json({ success: false, message: 'payment_mode must be cash, bank, or online.' });
  }
  const clientTxnId = String(payload.client_txn_id || payload.clientTxnId || '').trim();
  if (!clientTxnId || !UUID_REGEX.test(clientTxnId)) {
    return res.status(400).json({ success: false, message: 'client_txn_id must be a valid UUID.' });
  }

  req.body.payment_mode = mode;
  req.body.client_txn_id = clientTxnId;
  return next();
};

const validatePaymentEntry = (req, res, next) => {
  const payload = req.body || {};
  const type = String(payload.type || '').trim().toLowerCase();
  const amount = Number(payload.amount);
  const mode = String(payload.payment_mode || payload.paymentMode || '').trim().toLowerCase();

  if (!ALLOWED_PAYMENT_TYPES.has(type)) {
    return res.status(400).json({ success: false, message: 'type must be supplier, expense, or drawings.' });
  }
  if (type === 'supplier' && !Number.isFinite(Number(payload.supplier_id))) {
    return res.status(400).json({ success: false, message: 'supplier_id is required for supplier payment.' });
  }
  if (type !== 'supplier' && (payload.order_id !== undefined && payload.order_id !== null && payload.order_id !== '')) {
    return res.status(400).json({ success: false, message: 'order_id is not allowed for expense or drawings payment.' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be > 0.' });
  }
  if (!ALLOWED_PAYMENT_MODES.has(mode)) {
    return res.status(400).json({ success: false, message: 'payment_mode must be cash or bank.' });
  }
  const clientTxnId = String(payload.client_txn_id || payload.clientTxnId || '').trim();
  if (!clientTxnId || !UUID_REGEX.test(clientTxnId)) {
    return res.status(400).json({ success: false, message: 'client_txn_id must be a valid UUID.' });
  }

  req.body.type = type;
  req.body.payment_mode = mode;
  req.body.client_txn_id = clientTxnId;
  return next();
};

module.exports = {
  validateReceiptEntry,
  validatePaymentEntry,
};
