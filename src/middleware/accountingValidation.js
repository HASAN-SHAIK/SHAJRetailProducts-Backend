const ALLOWED_RECEIPT_MODES = new Set(['cash', 'bank', 'online']);
const ALLOWED_PAYMENT_MODES = new Set(['cash', 'bank']);
const ALLOWED_PAYMENT_TYPES = new Set(['supplier', 'expense', 'drawings']);

const validateReceiptEntry = (req, res, next) => {
  const payload = req.body || {};
  const amount = Number(payload.amount);
  const mode = String(payload.payment_mode || payload.paymentMode || '').trim().toLowerCase();
  if (!Number.isFinite(Number(payload.customer_id))) {
    return res.status(400).json({ success: false, message: 'customer_id is required.' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be > 0.' });
  }
  if (!ALLOWED_RECEIPT_MODES.has(mode)) {
    return res.status(400).json({ success: false, message: 'payment_mode must be cash, bank, or online.' });
  }
  if (!payload.client_txn_id) {
    return res.status(400).json({ success: false, message: 'client_txn_id is required.' });
  }
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
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be > 0.' });
  }
  if (!ALLOWED_PAYMENT_MODES.has(mode)) {
    return res.status(400).json({ success: false, message: 'payment_mode must be cash or bank.' });
  }
  if (!payload.client_txn_id) {
    return res.status(400).json({ success: false, message: 'client_txn_id is required.' });
  }
  return next();
};

module.exports = {
  validateReceiptEntry,
  validatePaymentEntry,
};
