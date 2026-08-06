const Joi = require('joi');

const listCustomersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(500).default(50),
  search: Joi.string().trim().allow('').default(''),
  sort_by: Joi.string().valid('name', 'created_at', 'current_balance').default('name'),
  sort_order: Joi.string().valid('asc', 'desc').default('asc'),
});

const customerIdParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const customerBodySchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
  phone: Joi.string().trim().allow('', null),
  mobile: Joi.string().trim().allow('', null),
  email: Joi.string().email().allow('', null),
  type: Joi.string().valid('retail', 'wholesale').default('retail'),
  shop_name: Joi.string().trim().allow('', null),
  gst_number: Joi.string().trim().allow('', null),
  credit_limit: Joi.number().min(0).default(0),
  current_balance: Joi.number().allow(null),
  notes: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  location: Joi.string().allow('', null),
  is_active: Joi.boolean(),
});

const customerUpdateSchema = customerBodySchema.fork(['name'], (schema) => schema.optional());

module.exports = {
  listCustomersQuerySchema,
  customerIdParamSchema,
  customerBodySchema,
  customerUpdateSchema,
};
