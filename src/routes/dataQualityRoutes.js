const express = require('express');
const isAdmin = require('../middleware/isAdmin');
const {
  getStockAuditTrail,
  runStockConsistency,
  getLatestStockConsistency,
  getDuplicateSuggestions,
  mergeDuplicate,
  exportBackup,
  verifyBackup
} = require('../controllers/dataQualityController');

const router = express.Router();

router.get('/stock-audit', isAdmin, getStockAuditTrail);
router.post('/stock-consistency/run', isAdmin, runStockConsistency);
router.get('/stock-consistency/latest', isAdmin, getLatestStockConsistency);
router.get('/duplicates', isAdmin, getDuplicateSuggestions);
router.post('/merge', isAdmin, mergeDuplicate);
router.get('/backup/export', isAdmin, exportBackup);
router.post('/backup/verify', isAdmin, verifyBackup);

module.exports = router;
