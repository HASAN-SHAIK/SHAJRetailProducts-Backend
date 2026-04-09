const express = require('express');
const {
  handleCreateCustomer,
  handleUpdateCustomer,
  handleGetCustomers,
  handleSearchCustomers,
  handleGetCustomerById,
  handleAddPayment,
  handleLedger
} = require('./controller');

const router = express.Router();

router.get('/search', handleSearchCustomers);
router.get('/', handleGetCustomers);
router.post('/', handleCreateCustomer);
router.get('/:id', handleGetCustomerById);
router.put('/:id', handleUpdateCustomer);
router.post('/:id/payments', handleAddPayment);
router.get('/:id/ledger', handleLedger);

module.exports = router;
