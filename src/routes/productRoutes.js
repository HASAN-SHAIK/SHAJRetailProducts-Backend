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
  getProductsPosLite,
  getProductById,
  getProductsCache,
  getProductsCacheDB,
  getProductsExtraDetails,
  bulkUpdateProducts
} = require('../controllers/productController');
const { importProducts, importProductsFromRows } = require('../controllers/productImport.controller');
const { requirePermission } = require('../middleware/requirePermission');
const isAdmin = require('../middleware/isAdmin');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.get('/', requirePermission('products:read'), getProducts);
router.get('/search', requirePermission('products:read'), searchProductsForSale);
router.get('/search/sale', requirePermission('products:read'), searchProductsForSale);
router.get('/search/purchase', requirePermission('products:read'), searchProductsForPurchase);
router.get('/cache', requirePermission('products:read'), getProductsCache);
router.get('/cache-db', requirePermission('products:read'), getProductsCacheDB);
router.get('/pos-lite', requirePermission('products:read'), getProductsPosLite);
router.get('/extra-details', requirePermission('products:read'), getProductsExtraDetails);
router.get('/barcode', requirePermission('products:read'), getProductByBarcodeForSale);
router.get('/barcode/:barcode', requirePermission('products:read'), getProductByBarcodeForSale);
router.get('/barcode/sale', requirePermission('products:read'), getProductByBarcodeForSale);
router.get('/barcode/sale/:barcode', requirePermission('products:read'), getProductByBarcodeForSale);
router.get('/barcode/purchase', requirePermission('products:read'), getProductByBarcodeForPurchase);
router.get('/barcode/purchase/:barcode', requirePermission('products:read'), getProductByBarcodeForPurchase);
router.put('/bulk-update', isAdmin, bulkUpdateProducts);
router.post('/import', isAdmin, upload.single('file'), importProducts);
router.post('/import-rows', isAdmin, importProductsFromRows);
router.get('/:id', requirePermission('products:read'), getProductById);
router.post('/', isAdmin, addProduct);
router.put('/:id', isAdmin, updateProduct);
router.delete('/:id', isAdmin, deleteProduct);

module.exports = router;
