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

const router = express.Router();

router.post('/', addExpense);
router.get('/', getExpenses);
router.get('/daily', getDailyReport);
router.get('/monthly', getMonthlyReport);
router.get('/staff-total', getStaffExpenseTotal);
router.put('/:id', updateExpense);
router.delete('/:id', deleteExpense);

module.exports = router;
