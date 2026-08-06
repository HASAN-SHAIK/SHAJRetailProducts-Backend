const express = require('express');
const controller = require('./expense.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListExpenses, controller.listExpenses);
router.post('/', controller.requireTenantUser, controller.validateCreateExpense, controller.createExpense);
router.put('/:id', controller.requireTenantUser, controller.validateExpenseId, controller.validateUpdateExpense, controller.updateExpense);
router.delete('/:id', controller.requireTenantUser, controller.validateExpenseId, controller.deleteExpense);

module.exports = router;
