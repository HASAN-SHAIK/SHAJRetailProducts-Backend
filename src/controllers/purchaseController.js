const purchaseService = require('../services/purchaseService');

const createPurchase = async (req, res) => {
  try {
    const batches = await purchaseService.createPurchase(req, req.body || {});
    return res.status(201).json({ success: true, batches });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { createPurchase };
