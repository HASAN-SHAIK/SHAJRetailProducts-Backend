const express = require('express');
const { listLedger, upsertLedger, getSummary, getReports, getFilingData } = require('../controllers/gstController');

const router = express.Router();

router.get('/ledger', listLedger);
router.post('/ledger', upsertLedger);
router.put('/ledger/:id', upsertLedger);
router.get('/summary', getSummary);
router.get('/reports', getReports);
router.get('/filing', getFilingData);

module.exports = router;
