const express = require('express');
const { createTenantHandler } = require('../controllers/platformController');

const router = express.Router();

router.post('/create-tenant', createTenantHandler);

module.exports = router;
