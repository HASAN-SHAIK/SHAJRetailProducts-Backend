const Joi = require('joi');

const listSalesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(20),
  search: Joi.string().trim().allow(''),
  customer_id: Joi.number().integer().positive().allow(''),
  sort_by: Joi.string().valid('created_at', 'total_price', 'id').default('created_at'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc'),
});

const saleIdParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const saleBodySchema = Joi.object({
  customer_id: Joi.number().integer().positive().allow(null),
  items: Joi.array().min(1).required(),
  payment_mode: Joi.string().valid('cash', 'bank', 'credit', 'online').allow(null),
  billing_type: Joi.string().valid('retail', 'wholesale').default('retail'),
  branch_id: Joi.string().uuid().allow(null),
  client_order_id: Joi.string().allow('', null),
}).unknown(true);

const saleUpdateSchema = saleBodySchema.fork(['items'], (s) => s.optional());

module.exports = {
  listSalesQuerySchema,
  saleIdParamSchema,
  saleBodySchema,
  saleUpdateSchema,
};
