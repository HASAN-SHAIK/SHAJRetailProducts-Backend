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
const { authMiddleware } = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/isAdmin');
const hydrateProductWeight = require('../middleware/hydrateProductWeight');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.get('/', hydrateProductWeight, getProducts);
router.get('/search', hydrateProductWeight, searchProductsForSale);
router.get('/search/sale', hydrateProductWeight, searchProductsForSale);
router.get('/search/purchase', searchProductsForPurchase);
router.get('/cache', getProductsCache);
router.get('/cache-db', getProductsCacheDB);
router.get('/pos-lite', hydrateProductWeight, getProductsPosLite);
router.get('/extra-details', getProductsExtraDetails);
router.get('/barcode', getProductByBarcodeForSale);
router.get('/barcode/:barcode', getProductByBarcodeForSale);
router.get('/barcode/sale', getProductByBarcodeForSale);
router.get('/barcode/sale/:barcode', getProductByBarcodeForSale);
router.get('/barcode/purchase', getProductByBarcodeForPurchase);
router.get('/barcode/purchase/:barcode', getProductByBarcodeForPurchase);
router.put('/bulk-update', isAdmin, bulkUpdateProducts);
router.post('/import', isAdmin, upload.single('file'), importProducts);
router.post('/import-rows', isAdmin, importProductsFromRows);
router.get('/:id', getProductById);
router.post('/', isAdmin, addProduct);
router.put('/:id', isAdmin, updateProduct);
router.delete('/:id', isAdmin, deleteProduct);

module.exports = router;
