const express = require('express');
const { sendBill } = require('../controllers/whatsapp.controller');

const router = express.Router();

router.post('/send-bill', sendBill);

module.exports = router;
