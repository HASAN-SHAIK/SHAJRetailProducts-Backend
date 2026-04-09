const purchaseRequestService = require('../services/purchaseRequest.service');

const createPurchaseRequest = async (req, res) => {
  try {
    const result = await purchaseRequestService.createPurchaseRequest(req, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Create failed' });
  }
};

const getPurchaseRequest = async (req, res) => {
  try {
    const result = await purchaseRequestService.getPurchaseRequestById(req, req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Fetch failed' });
  }
};

const sendPurchaseRequest = async (req, res) => {
  try {
    const result = await purchaseRequestService.sendPurchaseRequestEmail(req, req.params.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Send failed' });
  }
};

module.exports = {
  createPurchaseRequest,
  getPurchaseRequest,
  sendPurchaseRequest
};
