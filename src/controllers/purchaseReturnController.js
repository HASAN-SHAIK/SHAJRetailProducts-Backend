const purchaseReturnService = require('../services/purchaseReturnService');

const createPurchaseReturn = async (req, res) => {
  try {
    const result = await purchaseReturnService.createPurchaseReturn(req, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Failed to create return' });
  }
};

const listPurchaseReturns = async (req, res) => {
  try {
    const returns = await purchaseReturnService.listPurchaseReturns(req, {
      branch_id: req.query?.branch_id || req.query?.branchId || null,
      supplier_id: req.query?.supplier_id || req.query?.supplierId || null,
      purchase_id: req.query?.purchase_id || req.query?.purchaseId || null,
      limit: req.query?.limit
    });
    return res.status(200).json({ success: true, data: { returns }, returns });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load returns' });
  }
};

module.exports = { createPurchaseReturn, listPurchaseReturns };
