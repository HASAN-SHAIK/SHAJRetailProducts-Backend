const express = require('express');
const { getPlatformConfig } = require('../controllers/platformController');

const router = express.Router();

router.get('/config', getPlatformConfig);

module.exports = router;
