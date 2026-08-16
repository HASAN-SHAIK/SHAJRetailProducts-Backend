const express = require('express');
const {
  addExpense,
  updateExpense,
  deleteExpense,
  getExpenses,
  getDailyReport,
  getMonthlyReport,
  getStaffExpenseTotal,
} = require('../controllers/expenseController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.post('/', requirePermission('expenses:write'), addExpense);
router.get('/', requirePermission('expenses:read'), getExpenses);
router.get('/daily', requirePermission('expenses:read'), getDailyReport);
router.get('/monthly', requirePermission('expenses:read'), getMonthlyReport);
router.get('/staff-total', requirePermission('expenses:read'), getStaffExpenseTotal);
router.put('/:id', requirePermission('expenses:write'), updateExpense);
router.delete('/:id', requirePermission('expenses:write'), deleteExpense);

module.exports = router;
