const express = require('express');
const router = express.Router();
const { getProducts, addProduct, updateProduct, deleteProduct, searchProducts, getProductByBarcode } = require('../controllers/productController');
const {  authMiddleware } = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/isAdmin');

router.get('/', getProducts);
router.get('/search', searchProducts);
router.get('/barcode', getProductByBarcode);
router.get('/barcode/:code', getProductByBarcode);
router.post('/', isAdmin, addProduct);
router.put('/:id',isAdmin, updateProduct);
router.delete('/:id', isAdmin, deleteProduct);

module.exports = router;
