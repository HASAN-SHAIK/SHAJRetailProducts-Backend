const Joi = require('joi');

const listSuppliersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
  search: Joi.string().trim().allow('').default(''),
  sort_by: Joi.string().valid('name', 'created_at', 'current_balance').default('name'),
  sort_order: Joi.string().valid('asc', 'desc').default('asc'),
});

const supplierIdParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const supplierBodySchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
  mobile: Joi.string().trim().allow('', null),
  email: Joi.string().email().allow('', null),
  address: Joi.string().allow('', null),
  gst_number: Joi.string().trim().allow('', null),
  credit_limit: Joi.number().min(0).default(0),
  current_balance: Joi.number().default(0),
  branch_id: Joi.string().uuid().allow(null),
  is_active: Joi.boolean().default(true),
});

const supplierUpdateSchema = supplierBodySchema.fork(['name'], (s) => s.optional());

module.exports = {
  listSuppliersQuerySchema,
  supplierIdParamSchema,
  supplierBodySchema,
  supplierUpdateSchema,
};
