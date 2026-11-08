const stockService = require('../services/stockService');

const getStockByBranch = async (req, res) => {
  try {
    const productId = req.query?.product_id;
    const rows = await stockService.getBranchStock(req, productId);
    return res.status(200).json({ success: true, stock: rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const adjustStock = async (req, res) => {
  try {
    const adjustment = await stockService.adjustStock(req, req.body || {});
    return res.status(200).json({ success: true, adjustment });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const lookupProductForAudit = async (req, res) => {
  try {
    const query = req.query.barcode || req.query.query || req.query.product_id;
    const product = await stockService.lookupProductForAudit(req, query);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.status(200).json({ success: true, product });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Lookup failed' });
  }
};

const submitStockAuditScans = async (req, res) => {
  try {
    const summary = await stockService.submitStockAuditScans(req, req.body || {});
    return res.status(200).json({
      success: true,
      message: 'Physical stocktake audit processed successfully',
      data: summary,
      summary,
    });
  } catch (error) {
    const status = error.status || 400;
    return res.status(status).json({ success: false, error: error.message || 'Failed to submit stock audit' });
  }
};

module.exports = {
  getStockByBranch,
  adjustStock,
  lookupProductForAudit,
  submitStockAuditScans,
};
