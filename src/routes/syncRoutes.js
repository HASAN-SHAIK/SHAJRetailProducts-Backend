const express = require('express');
const router = express.Router();
const { syncProducts, syncBatches, syncSuppliers } = require('../controllers/syncController');
const syncOperationRoutes = require('./syncOperationRoutes');

router.use('/', syncOperationRoutes);
router.get('/products', syncProducts);
router.get('/batches', syncBatches);
router.get('/suppliers', syncSuppliers);

module.exports = router;
