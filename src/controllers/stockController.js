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

module.exports = { getStockByBranch, adjustStock };
