const express = require('express');
const { listLedger, upsertLedger, getSummary, getReports, getFilingData } = require('../controllers/gstController');
const { requirePermission } = require('../middleware/requirePermission');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.get('/ledger', requirePermission('reports:read'), listLedger);
router.post('/ledger', isAdmin, upsertLedger);
router.put('/ledger/:id', isAdmin, upsertLedger);
router.get('/summary', requirePermission('reports:read'), getSummary);
router.get('/reports', requirePermission('reports:read'), getReports);
router.get('/filing', requirePermission('reports:read'), getFilingData);

module.exports = router;
