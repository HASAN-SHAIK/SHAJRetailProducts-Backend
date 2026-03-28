const express = require('express');
const { searchHsnCodes, lookupHsn } = require('../controllers/hsnController');

const router = express.Router();

router.get('/search', searchHsnCodes);
router.get('/lookup', lookupHsn);

module.exports = router;
