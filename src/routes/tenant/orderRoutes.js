const express = require('express');
const { createOrder } = require('../../controllers/tenant/orderController');

const router = express.Router();

router.post('/', createOrder);

module.exports = router;
