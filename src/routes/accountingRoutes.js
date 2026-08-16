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

// Financial mutations remain Central/admin authority. Read-only books and
// statements reuse the existing reports:read permission rather than creating a
// parallel accounting role model.
router.post('/receipt', isAdmin, validateReceiptEntry, createReceipt);
router.post('/payment', isAdmin, validatePaymentEntry, createPayment);
router.get('/opening-setup', requirePermission('reports:read'), getOpeningSetupSummary);
router.post('/opening-setup', isAdmin, saveOpeningSetup);
router.post('/finalize-opening', isAdmin, finalizeOpening);
router.get('/receipt', requirePermission('reports:read'), getReceiptEntries);
router.get('/payment', requirePermission('reports:read'), getPaymentEntries);
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
