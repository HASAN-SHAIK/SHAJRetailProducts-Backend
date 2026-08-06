const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated, buildPaginationMeta } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createPurchaseService } = require('./purchase.service');
const {
  listPurchasesQuerySchema,
  purchaseIdParamSchema,
  purchaseBodySchema,
} = require('./purchase.validation');

const listPurchases = asyncHandler(async (req, res) => {
  const result = await createPurchaseService(req).list(req.query);
  return sendSuccess(res, { purchases: result.rows }, buildPaginationMeta(result));
});

const getPurchase = asyncHandler(async (req, res) => {
  const detail = await createPurchaseService(req).getById(req.params.id);
  return sendSuccess(res, detail);
});

const createPurchase = asyncHandler(async (req, res) => {
  const purchase = await createPurchaseService(req).create(req.body);
  return sendCreated(res, { purchase });
});

module.exports = {
  listPurchases,
  getPurchase,
  createPurchase,
  validateListPurchases: validateRequest(listPurchasesQuerySchema, 'query'),
  validatePurchaseId: validateRequest(purchaseIdParamSchema, 'params'),
  validateCreatePurchase: validateRequest(purchaseBodySchema, 'body'),
  requireTenantUser,
};
