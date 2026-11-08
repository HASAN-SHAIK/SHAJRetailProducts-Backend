const express = require('express');
const {
  handleCreateCustomer,
  handleUpdateCustomer,
  handleGetCustomers,
  handleSearchCustomers,
  handleGetCustomerById,
  handleAddPayment,
  handleLedger,
  handleSendReminder,
  handleGetReminders,
} = require('./controller');
const { requirePermission } = require('../../middleware/requirePermission');

const router = express.Router();

router.get('/search', requirePermission('customers:read'), handleSearchCustomers);
router.get('/', requirePermission('customers:read'), handleGetCustomers);
router.post('/', requirePermission('customers:write'), handleCreateCustomer);
router.get('/:id', requirePermission('customers:read'), handleGetCustomerById);
router.put('/:id', requirePermission('customers:write'), handleUpdateCustomer);
router.post('/:id/payments', requirePermission('customers:write'), handleAddPayment);
router.get('/:id/ledger', requirePermission('customers:read'), handleLedger);
router.post('/:id/send-reminder', requirePermission('customers:read'), handleSendReminder);
router.get('/:id/reminders', requirePermission('customers:read'), handleGetReminders);

module.exports = router;
