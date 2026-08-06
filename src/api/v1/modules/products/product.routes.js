const express = require('express');
const controller = require('./product.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListProducts, controller.listProducts);
router.get('/barcode/:barcode', controller.requireTenantUser, controller.validateBarcode, controller.getProductByBarcode);
router.get('/:id', controller.requireTenantUser, controller.validateProductId, controller.getProduct);
router.post('/', controller.requireAdmin, controller.validateCreateProduct, controller.createProduct);
router.put('/:id', controller.requireAdmin, controller.validateProductId, controller.validateUpdateProduct, controller.updateProduct);
router.delete('/:id', controller.requireAdmin, controller.validateProductId, controller.deleteProduct);

module.exports = router;
