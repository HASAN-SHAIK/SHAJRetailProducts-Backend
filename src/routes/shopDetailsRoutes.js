const express = require('express');
const router = express.Router();
const { getMyShopDetails, updateMyShopDetails } = require('../controllers/shopDetailsController');

router.get('/me', getMyShopDetails);
router.put('/me', updateMyShopDetails);

module.exports = router;
