const express = require('express');
const { addExpense, getExpenses, getSummary } = require('../controllers/expenseController');

const router = express.Router();

router.post('/', addExpense);
router.get('/', getExpenses);
router.get('/summary', getSummary);

module.exports = router;
