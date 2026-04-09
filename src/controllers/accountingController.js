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

module.exports = {
  createReceipt,
  createPayment,
  getCashBook,
  getBankBook,
  getLedger,
  getOutstanding,
};
