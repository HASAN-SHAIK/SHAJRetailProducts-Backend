const express = require('express');
const router = express.Router();
const { getMyShopDetails } = require('../controllers/shopDetailsController');

router.get('/me', getMyShopDetails);

module.exports = router;
