const purchaseService = require('../services/purchaseService');

const createPurchase = async (req, res) => {
  try {
    const result = await purchaseService.createPurchase(req, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const listPurchases = async (req, res) => {
  try {
    const purchases = await purchaseService.listPurchases(req, {
      branch_id: req.query?.branch_id || req.query?.branchId || null,
      supplier_id: req.query?.supplier_id || req.query?.supplierId || null,
      start_date: req.query?.start_date || req.query?.startDate || null,
      end_date: req.query?.end_date || req.query?.endDate || null,
      limit: req.query?.limit
    });
    return res.status(200).json({ success: true, data: { purchases }, purchases });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch purchases' });
  }
};

const getPurchaseDetail = async (req, res) => {
  try {
    const detail = await purchaseService.getPurchaseDetail(req, req.params.id);
    if (!detail) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }
    return res.status(200).json({ success: true, data: detail });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to fetch purchase' });
  }
};

module.exports = { createPurchase, listPurchases, getPurchaseDetail };
