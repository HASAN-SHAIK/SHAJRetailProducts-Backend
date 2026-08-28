const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireTenantUser, requireAdmin } = require('../../shared/middleware/authorizeRoles');
const { createPurchaseReturnService } = require('./purchaseReturn.service');
const { listPurchaseReturnsQuerySchema, purchaseReturnBodySchema } = require('./purchaseReturn.validation');

const listPurchaseReturns = asyncHandler(async (req, res) => {
  const returns = await createPurchaseReturnService(req).list(req.query);
  return sendSuccess(res, { returns });
});

const createPurchaseReturn = asyncHandler(async (req, res) => {
  const purchaseReturn = await createPurchaseReturnService(req).create(req.body);
  return sendCreated(res, { purchase_return: purchaseReturn });
});

module.exports = {
  listPurchaseReturns,
  createPurchaseReturn,
  validateListPurchaseReturns: validateRequest(listPurchaseReturnsQuerySchema, 'query'),
  validateCreatePurchaseReturn: validateRequest(purchaseReturnBodySchema, 'body'),
  requireTenantUser,
  requireAdmin,
};
