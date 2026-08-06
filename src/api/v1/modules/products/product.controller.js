const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated, sendNoContent, buildPaginationMeta } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireAdmin, requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createProductService } = require('./product.service');
const {
  listProductsQuerySchema,
  productIdParamSchema,
  barcodeParamSchema,
  productBodySchema,
  productUpdateSchema,
} = require('./product.validation');

const listProducts = asyncHandler(async (req, res) => {
  const result = await createProductService(req).list(req.query);
  return sendSuccess(res, { products: result.items }, buildPaginationMeta(result));
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await createProductService(req).getById(req.params.id);
  return sendSuccess(res, { product });
});

const getProductByBarcode = asyncHandler(async (req, res) => {
  const product = await createProductService(req).getByBarcode(req.params.barcode);
  return sendSuccess(res, { product });
});

const createProduct = asyncHandler(async (req, res) => {
  const product = await createProductService(req).create(req.body);
  return sendCreated(res, { product });
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await createProductService(req).update(req.params.id, req.body);
  return sendSuccess(res, { product });
});

const deleteProduct = asyncHandler(async (req, res) => {
  await createProductService(req).remove(req.params.id);
  return sendNoContent(res);
});

module.exports = {
  listProducts,
  getProduct,
  getProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct,
  validateListProducts: validateRequest(listProductsQuerySchema, 'query'),
  validateProductId: validateRequest(productIdParamSchema, 'params'),
  validateBarcode: validateRequest(barcodeParamSchema, 'params'),
  validateCreateProduct: validateRequest(productBodySchema, 'body'),
  validateUpdateProduct: validateRequest(productUpdateSchema, 'body'),
  requireAdmin,
  requireTenantUser,
};
