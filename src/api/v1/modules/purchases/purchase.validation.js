const Joi = require('joi');

const listPurchasesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(20),
  supplier_id: Joi.number().integer().positive().allow(''),
  branch_id: Joi.string().uuid().allow(''),
  start_date: Joi.date().iso().allow(''),
  end_date: Joi.date().iso().allow(''),
});

const purchaseIdParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const purchaseBodySchema = Joi.object({
  supplier_id: Joi.number().integer().positive().required(),
  items: Joi.array().min(1).required(),
  payment_mode: Joi.string().valid('cash', 'bank', 'credit', 'online').allow(null),
  branch_id: Joi.string().uuid().allow(null),
  invoice_number: Joi.string().allow('', null),
  notes: Joi.string().allow('', null),
}).unknown(true);

module.exports = {
  listPurchasesQuerySchema,
  purchaseIdParamSchema,
  purchaseBodySchema,
};
