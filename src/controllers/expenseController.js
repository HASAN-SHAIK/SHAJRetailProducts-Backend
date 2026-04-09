const expenseService = require('../services/expenseService');
const pool = require('../db');

const addExpense = async (req, res) => {
  try {
    const created = await expenseService.addExpense(req, req.body || {});
    return res.status(201).json({ success: true, expense: created });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const updateExpense = async (req, res) => {
  try {
    const payload = { ...(req.body || {}), expenseId: req.params.id };
    const updated = await expenseService.addExpense(req, payload);
    return res.status(200).json({ success: true, expense: updated });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const deleteExpense = async (req, res) => {
  try {
    const requestPool = req.tenantPool || pool;
    await requestPool.query(`DELETE FROM expenses WHERE id = $1`, [req.params.id]);
    return res.status(200).json({ success: true });
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

const getDailyReport = async (req, res) => {
  try {
    const report = await expenseService.getDailyReport(req);
    return res.status(200).json({ success: true, report });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getMonthlyReport = async (req, res) => {
  try {
    const report = await expenseService.getMonthlyReport(req);
    return res.status(200).json({ success: true, report });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = {
  addExpense,
  updateExpense,
  deleteExpense,
  getExpenses,
  getDailyReport,
  getMonthlyReport,
};
