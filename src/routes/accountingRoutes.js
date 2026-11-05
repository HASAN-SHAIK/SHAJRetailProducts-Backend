const express = require('express');
const { validateReceiptEntry, validatePaymentEntry } = require('../middleware/accountingValidation');
const { requirePermission } = require('../middleware/requirePermission');
const isAdmin = require('../middleware/isAdmin');
const {
  createReceipt,
  createPayment,
  getCashBook,
  getBankBook,
  getLedger,
  getOutstanding,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getLedgerGstSummary,
  getReceiptEntries,
  getPaymentEntries,
  saveOpeningSetup,
  getOpeningSetupSummary,
  finalizeOpening,
  getReconciliation,
} = require('../controllers/accountingController');

const router = express.Router();

// Operational receipt and payment entries are authorized via dedicated accounting permissions.
// Opening setup and finalization remain strictly admin authority.
router.post('/receipt', requirePermission('accounting:receipt:create'), validateReceiptEntry, createReceipt);
router.post('/payment', requirePermission('accounting:payment:create'), validatePaymentEntry, createPayment);
router.get('/receipt', requirePermission('accounting:receipt:read'), getReceiptEntries);
router.get('/payment', requirePermission('accounting:payment:read'), getPaymentEntries);

router.get('/opening-setup', isAdmin, getOpeningSetupSummary);
router.post('/opening-setup', isAdmin, saveOpeningSetup);
router.post('/finalize-opening', isAdmin, finalizeOpening);

// Read-only accounting books and reports require reports:read permission.
router.get('/cashbook', requirePermission('reports:read'), getCashBook);
router.get('/bankbook', requirePermission('reports:read'), getBankBook);
router.get('/cash-book', requirePermission('reports:read'), getCashBook);
router.get('/bank-book', requirePermission('reports:read'), getBankBook);
router.get('/ledger', requirePermission('reports:read'), getLedger);
router.get('/reconcile', requirePermission('reports:read'), getReconciliation);
router.get('/outstanding', requirePermission('reports:read'), getOutstanding);
router.get('/reports/trial-balance', requirePermission('reports:read'), getTrialBalance);
router.get('/reports/profit-loss', requirePermission('reports:read'), getProfitAndLoss);
router.get('/reports/balance-sheet', requirePermission('reports:read'), getBalanceSheet);
router.get('/reports/gst-summary', requirePermission('reports:read'), getLedgerGstSummary);

module.exports = router;
