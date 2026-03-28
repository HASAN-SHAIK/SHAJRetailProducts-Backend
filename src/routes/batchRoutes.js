const express = require('express');
const { getBatches } = require('../controllers/batchController');

const router = express.Router();

router.get('/', getBatches);

module.exports = router;
