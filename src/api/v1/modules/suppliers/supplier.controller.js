const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated, sendNoContent, buildPaginationMeta } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireAdmin, requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createSupplierService } = require('./supplier.service');
const {
  listSuppliersQuerySchema,
  supplierIdParamSchema,
  supplierBodySchema,
  supplierUpdateSchema,
} = require('./supplier.validation');

const listSuppliers = asyncHandler(async (req, res) => {
  const result = await createSupplierService(req).list(req.query);
  return sendSuccess(res, { suppliers: result.items }, buildPaginationMeta(result));
});

const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await createSupplierService(req).getById(req.params.id);
  return sendSuccess(res, { supplier });
});

const createSupplier = asyncHandler(async (req, res) => {
  const supplier = await createSupplierService(req).create(req.body);
  return sendCreated(res, { supplier });
});

const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await createSupplierService(req).update(req.params.id, req.body);
  return sendSuccess(res, { supplier });
});

const deleteSupplier = asyncHandler(async (req, res) => {
  await createSupplierService(req).remove(req.params.id);
  return sendNoContent(res);
});

module.exports = {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  validateListSuppliers: validateRequest(listSuppliersQuerySchema, 'query'),
  validateSupplierId: validateRequest(supplierIdParamSchema, 'params'),
  validateCreateSupplier: validateRequest(supplierBodySchema, 'body'),
  validateUpdateSupplier: validateRequest(supplierUpdateSchema, 'body'),
  requireAdmin,
  requireTenantUser,
};
