const express = require('express');
const { getProducts, createProduct, getProductByBarcode } = require('../../controllers/tenant/productController');
const router = express.Router();

router.get('/', getProducts);
router.post('/', createProduct);
router.get('/barcode/:code', getProductByBarcode);

module.exports = router;
