const Joi = require('joi');

const batchIdSchema = Joi.alternatives().try(
  Joi.number().integer().positive(),
  Joi.string().trim().min(1)
);

const listPurchaseReturnsQuerySchema = Joi.object({
  branch_id: Joi.string().uuid().allow(''),
  supplier_id: Joi.number().integer().positive().allow(''),
  purchase_id: Joi.number().integer().positive().allow(''),
  limit: Joi.number().integer().min(1).max(500).default(100),
});

const purchaseReturnBodySchema = Joi.object({
  purchase_id: Joi.number().integer().positive().required(),
  supplier_id: Joi.number().integer().positive().required(),
  branch_id: Joi.string().uuid().allow(null),
  reason: Joi.string().trim().max(500).allow('', null),
  items: Joi.array().min(1).items(Joi.object({
    batch_id: batchIdSchema.required(),
    product_id: Joi.number().integer().positive().required(),
    quantity: Joi.number().positive().required(),
  })).required(),
});

module.exports = { listPurchaseReturnsQuerySchema, purchaseReturnBodySchema };
