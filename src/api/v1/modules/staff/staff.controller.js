const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated, sendNoContent } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireAdmin, requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createStaffService } = require('./staff.service');
const salaryService = require('../../../../services/salaryService');
const staffService = require('../../../../services/staffService');
const {
  listStaffQuerySchema,
  staffIdParamSchema,
  salaryIdParamSchema,
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

const listSalaries = asyncHandler(async (req, res) => {
  const salaries = await salaryService.getSalaries(req, req.query || {});
  return sendSuccess(res, { salaries, total: salaries.length });
});

const createSalary = asyncHandler(async (req, res) => {
  const salary = await salaryService.addSalary(req, req.body || {});
  return sendCreated(res, { salary });
});

const updateSalary = asyncHandler(async (req, res) => {
  const salary = await salaryService.updateSalary(req, req.params.salaryId, req.body || {});
  return sendSuccess(res, { salary });
});

const deleteSalary = asyncHandler(async (req, res) => {
  await salaryService.deleteSalary(req, req.params.salaryId);
  return sendNoContent(res);
});

const getPerformance = asyncHandler(async (req, res) => {
  const performance = await staffService.getStaffPerformance(req, req.query || {});
  return sendSuccess(res, performance);
});

module.exports = {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  listSalaries,
  createSalary,
  updateSalary,
  deleteSalary,
  getPerformance,
  validateListStaff: validateRequest(listStaffQuerySchema, 'query'),
  validateStaffId: validateRequest(staffIdParamSchema, 'params'),
  validateSalaryId: validateRequest(salaryIdParamSchema, 'params'),
  validateCreateStaff: validateRequest(staffBodySchema, 'body'),
  validateUpdateStaff: validateRequest(staffUpdateSchema, 'body'),
  requireAdmin,
  requireTenantUser,
};
