const express = require('express');
const controller = require('./category.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListCategories, controller.listCategories);
router.get('/:name/products', controller.requireTenantUser, controller.validateCategoryName, controller.getCategoryProducts);
router.put('/:name', controller.requireAdmin, controller.validateCategoryName, controller.validateRenameCategory, controller.renameCategory);
router.delete('/:name', controller.requireAdmin, controller.validateCategoryName, controller.deleteCategory);

module.exports = router;
