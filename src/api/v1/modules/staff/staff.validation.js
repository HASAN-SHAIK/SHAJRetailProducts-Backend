const Joi = require('joi');

const listStaffQuerySchema = Joi.object({
  search: Joi.string().trim().allow(''),
  status: Joi.string().valid('active', 'inactive').allow(''),
  branch_id: Joi.string().uuid().allow(''),
});

const staffIdParamSchema = Joi.object({
  id: Joi.string().required(),
});

const staffBodySchema = Joi.object({
  staffId: Joi.string().required(),
  name: Joi.string().trim().min(1).required(),
  phone: Joi.string().allow('', null),
  role: Joi.string().allow('', null),
  salary: Joi.number().min(0).allow(null),
  joinDate: Joi.date().iso().allow(null),
  status: Joi.string().valid('active', 'inactive').default('active'),
  branch_id: Joi.string().uuid().allow(null),
});

const staffUpdateSchema = staffBodySchema.fork(['staffId', 'name'], (s) => s.optional());

module.exports = {
  listStaffQuerySchema,
  staffIdParamSchema,
  staffBodySchema,
  staffUpdateSchema,
};
