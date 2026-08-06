const Joi = require('joi');

const listCategoriesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
  search: Joi.string().trim().allow('').default(''),
});

const categoryNameParamSchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
});

const renameCategorySchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
});

module.exports = {
  listCategoriesQuerySchema,
  categoryNameParamSchema,
  renameCategorySchema,
};
