const express = require('express');
const multer = require('multer');
const { parseInvoice, savePurchase, generatePurchasePdf } = require('../controllers/purchaseInvoice.controller');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.post('/parse-invoice', isAdmin, upload.single('file'), parseInvoice);
router.post('/save', isAdmin, savePurchase);
router.post('/generate-pdf', isAdmin, generatePurchasePdf);

module.exports = router;
