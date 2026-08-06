const express = require('express');
const {
  submitSyncOperations,
  getSyncOperationsStatus,
  getSyncMetrics,
} = require('../controllers/syncOperationController');

const router = express.Router();

router.post('/operations', submitSyncOperations);
router.get('/operations/status', getSyncOperationsStatus);
router.get('/metrics', getSyncMetrics);

module.exports = router;
