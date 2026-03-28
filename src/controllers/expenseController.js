const expenseService = require('../services/expenseService');

const addExpense = async (req, res) => {
  try {
    const created = await expenseService.addExpense(req, req.body || {});
    return res.status(201).json({ success: true, expense: created });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getExpenses = async (req, res) => {
  try {
    const list = await expenseService.getExpenses(req, req.query || {});
    return res.status(200).json({ success: true, expenses: list });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getSummary = async (req, res) => {
  try {
    const summary = await expenseService.getSummary(req);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { addExpense, getExpenses, getSummary };
