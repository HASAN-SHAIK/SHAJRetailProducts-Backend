const productImportService = require('../services/productImport.service');
const { validateProductImportFile } = require('../security/productImportUploadPolicy');

const importProducts = async (req, res) => {
  try {
    validateProductImportFile(req.file);
    const summary = await productImportService.importProducts(req, req.file);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Import failed';
    return res.status(status).json({ success: false, message, code: error.code });
  }
};

const importProductsFromRows = async (req, res) => {
  try {
    const rows = req.body?.rows || [];
    const summary = await productImportService.importProductsFromRows(req, rows);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Import failed';
    return res.status(status).json({ success: false, message });
  }
};

module.exports = { importProducts, importProductsFromRows };
