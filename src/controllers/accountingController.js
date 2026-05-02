const accountingService = require('../services/accountingService');

const createReceipt = async (req, res) => {
  try {
    const result = await accountingService.createReceipt(req, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to create receipt' });
  }
};

const createPayment = async (req, res) => {
  try {
    const result = await accountingService.createPayment(req, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to create payment' });
  }
};

const getCashBook = async (req, res) => {
  try {
    const result = await accountingService.getCashBook(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    return res.status(500).json({ success: false, message: error.message || 'Failed to load cash book' });
  }
};

const getBankBook = async (req, res) => {
  try {
    const result = await accountingService.getBankBook(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    return res.status(500).json({ success: false, message: error.message || 'Failed to load bank book' });
  }
};

const getLedger = async (req, res) => {
  try {
    const result = await accountingService.getLedger(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to load ledger' });
  }
};

const getOutstanding = async (req, res) => {
  try {
    const result = await accountingService.getOutstanding(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to load outstanding' });
  }
};

const getTrialBalance = async (req, res) => {
  try {
    const result = await accountingService.getTrialBalance(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    return res.status(500).json({ success: false, message: error.message || 'Failed to load trial balance' });
  }
};

const getProfitAndLoss = async (req, res) => {
  try {
    const result = await accountingService.getProfitAndLoss(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    return res.status(500).json({ success: false, message: error.message || 'Failed to load P&L' });
  }
};

const getBalanceSheet = async (req, res) => {
  try {
    const result = await accountingService.getBalanceSheet(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    return res.status(500).json({ success: false, message: error.message || 'Failed to load balance sheet' });
  }
};

const getLedgerGstSummary = async (req, res) => {
  try {
    const result = await accountingService.getLedgerGstSummary(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    return res.status(500).json({ success: false, message: error.message || 'Failed to load GST summary' });
  }
};

const getReceiptEntries = async (req, res) => {
  try {
    const result = await accountingService.getReceiptEntries(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    return res.status(500).json({ success: false, message: error.message || 'Failed to load receipt entries' });
  }
};

const getPaymentEntries = async (req, res) => {
  try {
    const result = await accountingService.getPaymentEntries(req, req.query || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    return res.status(500).json({ success: false, message: error.message || 'Failed to load payment entries' });
  }
};

const saveOpeningSetup = async (req, res) => {
  try {
    const result = await accountingService.saveOpeningSetup(req, req.body || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to save opening setup' });
  }
};

const getOpeningSetupSummary = async (req, res) => {
  try {
    const result = await accountingService.getOpeningSetupSummary(req);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to load opening setup summary' });
  }
};

const finalizeOpening = async (req, res) => {
  try {
    const result = await accountingService.finalizeOpening(req, req.body || {});
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to finalize opening' });
  }
};

const getReconciliation = async (req, res) => {
  try {
    const result = await accountingService.getReconciliation(req);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to reconcile accounts' });
  }
};

module.exports = {
  createReceipt,
  createPayment,
  getCashBook,
  getBankBook,
  getLedger,
  getOutstanding,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getLedgerGstSummary,
  getReceiptEntries,
  getPaymentEntries,
  saveOpeningSetup,
  getOpeningSetupSummary,
  finalizeOpening,
  getReconciliation,
};
