const express = require('express');
const { getSalesSummary } = require('../../controllers/tenant/reportController');
const { requireFeature } = require('../../middleware/featureGuard');

const router = express.Router();

router.get('/summary', requireFeature('advanced_reports'), getSalesSummary);

module.exports = router;
