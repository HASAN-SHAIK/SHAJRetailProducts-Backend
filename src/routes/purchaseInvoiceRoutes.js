const express = require('express');
const multer = require('multer');
const { parseInvoice, importPdfInvoice, savePurchase, generatePurchasePdf } = require('../controllers/purchaseInvoice.controller');
const isAdmin = require('../middleware/isAdmin');
const { invoiceUploadFileFilter } = require('../security/invoiceUploadPolicy');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: invoiceUploadFileFilter,
});

router.post('/parse-invoice', isAdmin, upload.single('file'), parseInvoice);
router.post('/import-pdf', isAdmin, upload.single('file'), importPdfInvoice);
router.post('/save', isAdmin, savePurchase);
router.post('/generate-pdf', isAdmin, generatePurchasePdf);

module.exports = router;
