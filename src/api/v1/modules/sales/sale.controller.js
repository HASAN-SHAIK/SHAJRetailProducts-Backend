const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated, sendNoContent, buildPaginationMeta } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createSaleService } = require('./sale.service');
const {
  listSalesQuerySchema,
  saleIdParamSchema,
  saleBodySchema,
  saleUpdateSchema,
} = require('./sale.validation');

const listSales = asyncHandler(async (req, res) => {
  const result = await createSaleService(req).list(req.query);
  return sendSuccess(res, { sales: result.rows }, buildPaginationMeta(result));
});

const getSale = asyncHandler(async (req, res) => {
  const sale = await createSaleService(req).getById(req.params.id);
  return sendSuccess(res, sale?.data || sale);
});

const createSale = asyncHandler(async (req, res) => {
  const sale = await createSaleService(req).create(req.body);
  return sendCreated(res, sale?.data || sale);
});

const updateSale = asyncHandler(async (req, res) => {
  const sale = await createSaleService(req).update(req.params.id, req.body);
  return sendSuccess(res, sale?.data || sale);
});

const deleteSale = asyncHandler(async (req, res) => {
  await createSaleService(req).remove(req.params.id);
  return sendNoContent(res);
});

module.exports = {
  listSales,
  getSale,
  createSale,
  updateSale,
  deleteSale,
  validateListSales: validateRequest(listSalesQuerySchema, 'query'),
  validateSaleId: validateRequest(saleIdParamSchema, 'params'),
  validateCreateSale: validateRequest(saleBodySchema, 'body'),
  validateUpdateSale: validateRequest(saleUpdateSchema, 'body'),
  requireTenantUser,
};
