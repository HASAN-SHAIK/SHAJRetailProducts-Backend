const express = require('express');
const isAdmin = require('../middleware/isAdmin');
const {
  createPurchaseRequest,
  getPurchaseRequest,
  sendPurchaseRequest
} = require('../controllers/purchaseRequest.controller');

const router = express.Router();

router.post('/requests', isAdmin, createPurchaseRequest);
router.get('/requests/:id', isAdmin, getPurchaseRequest);
router.post('/requests/:id/send', isAdmin, sendPurchaseRequest);

module.exports = router;
