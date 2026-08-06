const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated, sendNoContent, buildPaginationMeta } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createCustomerService } = require('./customer.service');
const {
  listCustomersQuerySchema,
  customerIdParamSchema,
  customerBodySchema,
  customerUpdateSchema,
} = require('./customer.validation');

const listCustomers = asyncHandler(async (req, res) => {
  const result = await createCustomerService(req).list(req.query);
  return sendSuccess(res, { customers: result.items }, buildPaginationMeta(result));
});

const getCustomer = asyncHandler(async (req, res) => {
  const detail = await createCustomerService(req).getById(req.params.id);
  return sendSuccess(res, detail);
});

const createCustomer = asyncHandler(async (req, res) => {
  const customer = await createCustomerService(req).create(req.body);
  return sendCreated(res, { customer });
});

const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await createCustomerService(req).update(req.params.id, req.body);
  return sendSuccess(res, { customer });
});

const deleteCustomer = asyncHandler(async (req, res) => {
  await createCustomerService(req).remove(req.params.id);
  return sendNoContent(res);
});

module.exports = {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  validateListCustomers: validateRequest(listCustomersQuerySchema, 'query'),
  validateCustomerId: validateRequest(customerIdParamSchema, 'params'),
  validateCreateCustomer: validateRequest(customerBodySchema, 'body'),
  validateUpdateCustomer: validateRequest(customerUpdateSchema, 'body'),
  requireTenantUser,
};
