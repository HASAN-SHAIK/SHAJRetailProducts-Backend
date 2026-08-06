const Joi = require('joi');

const listProductsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().allow('').default(''),
  category: Joi.string().trim().allow('').default(''),
  sort_by: Joi.string().valid('name', 'selling_price', 'stock_quantity', 'created_at').default('created_at'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc'),
});

const productIdParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const barcodeParamSchema = Joi.object({
  barcode: Joi.string().trim().min(1).required(),
});

const productBodySchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
  category: Joi.string().trim().allow('', null),
  company: Joi.string().trim().allow('', null),
  selling_price: Joi.number().min(0).required(),
  mrp: Joi.number().min(0).allow(null),
  purchase_price: Joi.number().min(0).allow(null),
  hsn_code: Joi.string().trim().allow('', null),
  gst_percentage: Joi.number().min(0).max(100).default(0),
  is_weight_based: Joi.boolean().default(false),
  is_batch_enabled: Joi.boolean().default(false),
  stock_quantity: Joi.number().min(0).default(0),
  barcode: Joi.string().trim().allow('', null),
  branch_id: Joi.string().uuid().allow(null),
  expiry_date: Joi.date().iso().allow(null),
});

const productUpdateSchema = productBodySchema.fork(['name', 'selling_price'], (schema) => schema.optional());

module.exports = {
  listProductsQuerySchema,
  productIdParamSchema,
  barcodeParamSchema,
  productBodySchema,
  productUpdateSchema,
};
