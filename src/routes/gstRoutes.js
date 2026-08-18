const express = require('express');
const { listLedger, upsertLedger, getSummary, getFilingData } = require('../controllers/gstController');
const { getCanonicalGstReports } = require('../controllers/canonicalGstReportController');
const { requirePermission } = require('../middleware/requirePermission');
const { requireReportScope } = require('../middleware/requireReportScope');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.get('/ledger', requirePermission('reports:read'), listLedger);
router.post('/ledger', isAdmin, upsertLedger);
router.put('/ledger/:id', isAdmin, upsertLedger);
router.get('/summary', requirePermission('reports:read'), getSummary);
router.get('/reports', requirePermission('reports:read'), requireReportScope, getCanonicalGstReports);
router.get('/filing', requirePermission('reports:read'), getFilingData);

module.exports = router;
