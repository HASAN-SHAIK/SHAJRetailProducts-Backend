const express = require('express');
const { validateReceiptEntry, validatePaymentEntry } = require('../middleware/accountingValidation');
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

router.post('/receipt', validateReceiptEntry, createReceipt);
router.post('/payment', validatePaymentEntry, createPayment);
router.get('/opening-setup', getOpeningSetupSummary);
router.post('/opening-setup', saveOpeningSetup);
router.post('/finalize-opening', finalizeOpening);
router.get('/receipt', getReceiptEntries);
router.get('/payment', getPaymentEntries);
router.get('/cashbook', getCashBook);
router.get('/bankbook', getBankBook);
router.get('/cash-book', getCashBook);
router.get('/bank-book', getBankBook);
router.get('/ledger', getLedger);
router.get('/reconcile', getReconciliation);
router.get('/outstanding', getOutstanding);
router.get('/reports/trial-balance', getTrialBalance);
router.get('/reports/profit-loss', getProfitAndLoss);
router.get('/reports/balance-sheet', getBalanceSheet);
router.get('/reports/gst-summary', getLedgerGstSummary);

module.exports = router;
