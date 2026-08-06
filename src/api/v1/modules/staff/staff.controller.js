const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated, sendNoContent } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createStaffService } = require('./staff.service');
const {
  listStaffQuerySchema,
  staffIdParamSchema,
  staffBodySchema,
  staffUpdateSchema,
} = require('./staff.validation');

const listStaff = asyncHandler(async (req, res) => {
  const staff = await createStaffService(req).list(req.query);
  return sendSuccess(res, { staff, total: staff.length });
});

const getStaff = asyncHandler(async (req, res) => {
  const member = await createStaffService(req).getById(req.params.id);
  return sendSuccess(res, { staff: member });
});

const createStaff = asyncHandler(async (req, res) => {
  const staff = await createStaffService(req).create(req.body);
  return sendCreated(res, { staff });
});

const updateStaff = asyncHandler(async (req, res) => {
  const staff = await createStaffService(req).update(req.params.id, req.body);
  return sendSuccess(res, { staff });
});

const deleteStaff = asyncHandler(async (req, res) => {
  await createStaffService(req).remove(req.params.id);
  return sendNoContent(res);
});

module.exports = {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  validateListStaff: validateRequest(listStaffQuerySchema, 'query'),
  validateStaffId: validateRequest(staffIdParamSchema, 'params'),
  validateCreateStaff: validateRequest(staffBodySchema, 'body'),
  validateUpdateStaff: validateRequest(staffUpdateSchema, 'body'),
  requireTenantUser,
};
