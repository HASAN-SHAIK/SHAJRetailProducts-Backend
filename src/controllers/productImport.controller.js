const productImportService = require('../services/productImport.service');
const { validateProductImportFile } = require('../security/productImportUploadPolicy');

const MAX_PRODUCT_IMPORT_ROWS = 500;

const assertProductImportRowLimit = (rows) => {
  if (Array.isArray(rows) && rows.length > MAX_PRODUCT_IMPORT_ROWS) {
    const error = new Error(`Product import is limited to ${MAX_PRODUCT_IMPORT_ROWS} rows per request`);
    error.status = 413;
    error.code = 'PRODUCT_IMPORT_ROW_LIMIT_EXCEEDED';
    throw error;
  }
};

const respondImportError = (res, error) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) {
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    });
  }
  return res.status(status).json({
    success: false,
    message: error?.message || 'Import failed',
    code: error?.code,
  });
};

const importProducts = async (req, res) => {
  try {
    validateProductImportFile(req.file);
    const summary = await productImportService.importProducts(req, req.file);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    return respondImportError(res, error);
  }
};

const importProductsFromRows = async (req, res) => {
  try {
    const rows = req.body?.rows || [];
    assertProductImportRowLimit(rows);
    const summary = await productImportService.importProductsFromRows(req, rows);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    return respondImportError(res, error);
  }
};

module.exports = {
  importProducts,
  importProductsFromRows,
  assertProductImportRowLimit,
  MAX_PRODUCT_IMPORT_ROWS,
};
