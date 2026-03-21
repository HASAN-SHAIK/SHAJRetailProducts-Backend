const express = require('express');
const router = express.Router();
const {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  searchProductsForSale,
  searchProductsForPurchase,
  getProductByBarcodeForSale,
  getProductByBarcodeForPurchase,
  getProductsCache,
  getProductsCacheDB
} = require('../controllers/productController');
const {  authMiddleware } = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/isAdmin');

router.get('/', getProducts);
router.get('/search', searchProductsForSale);
router.get('/search/sale', searchProductsForSale);
router.get('/search/purchase', searchProductsForPurchase);
router.get('/cache', getProductsCache);
router.get('/cache-db', getProductsCacheDB);
router.get('/barcode', getProductByBarcodeForSale);
router.get('/barcode/:barcode', getProductByBarcodeForSale);
router.get('/barcode/sale', getProductByBarcodeForSale);
router.get('/barcode/sale/:barcode', getProductByBarcodeForSale);
router.get('/barcode/purchase', getProductByBarcodeForPurchase);
router.get('/barcode/purchase/:barcode', getProductByBarcodeForPurchase);
router.post('/', isAdmin, addProduct);
router.put('/:id',isAdmin, updateProduct);
router.delete('/:id', isAdmin, deleteProduct);

module.exports = router;
