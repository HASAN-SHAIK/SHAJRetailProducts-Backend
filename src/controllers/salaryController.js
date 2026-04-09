const salaryService = require('../services/salaryService');

const createSalary = async (req, res) => {
  try {
    const created = await salaryService.addSalary(req, req.body || {});
    return res.status(201).json({ success: true, salary: created });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const listSalaries = async (req, res) => {
  try {
    const list = await salaryService.getSalaries(req, req.query || {});
    return res.status(200).json({ success: true, salaries: list });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const updateSalary = async (req, res) => {
  try {
    const updated = await salaryService.updateSalary(req, req.params.id, req.body || {});
    return res.status(200).json({ success: true, salary: updated });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const deleteSalary = async (req, res) => {
  try {
    await salaryService.deleteSalary(req, req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { createSalary, listSalaries, updateSalary, deleteSalary };
