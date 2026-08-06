const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendNoContent, buildPaginationMeta } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireAdmin, requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createCategoryService } = require('./category.service');
const { listCategoriesQuerySchema, categoryNameParamSchema, renameCategorySchema } = require('./category.validation');

const listCategories = asyncHandler(async (req, res) => {
  const result = await createCategoryService(req).list(req.query);
  return sendSuccess(res, { categories: result.items }, buildPaginationMeta(result));
});

const getCategoryProducts = asyncHandler(async (req, res) => {
  const result = await createCategoryService(req).getProducts(req.params.name, req.query);
  return sendSuccess(res, { category: result.category, products: result.products }, buildPaginationMeta(result));
});

const renameCategory = asyncHandler(async (req, res) => {
  const result = await createCategoryService(req).rename(req.params.name, req.body.name);
  return sendSuccess(res, result);
});

const deleteCategory = asyncHandler(async (req, res) => {
  await createCategoryService(req).remove(req.params.name);
  return sendNoContent(res);
});

module.exports = {
  listCategories,
  getCategoryProducts,
  renameCategory,
  deleteCategory,
  validateListCategories: validateRequest(listCategoriesQuerySchema, 'query'),
  validateCategoryName: validateRequest(categoryNameParamSchema, 'params'),
  validateRenameCategory: validateRequest(renameCategorySchema, 'body'),
  requireAdmin,
  requireTenantUser,
};
