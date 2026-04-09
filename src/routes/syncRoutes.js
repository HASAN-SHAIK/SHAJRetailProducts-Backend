const express = require('express');
const router = express.Router();
const { syncProducts, syncBatches, syncSuppliers } = require('../controllers/syncController');

router.get('/products', syncProducts);
router.get('/batches', syncBatches);
router.get('/suppliers', syncSuppliers);

module.exports = router;
