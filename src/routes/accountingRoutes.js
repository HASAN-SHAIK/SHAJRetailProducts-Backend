const express = require('express');
const {
  createReceipt,
  createPayment,
  getCashBook,
  getBankBook,
  getLedger,
  getOutstanding,
} = require('../controllers/accountingController');

const router = express.Router();

router.post('/receipt', createReceipt);
router.post('/payment', createPayment);
router.get('/cashbook', getCashBook);
router.get('/bankbook', getBankBook);
router.get('/ledger', getLedger);
router.get('/outstanding', getOutstanding);

module.exports = router;
