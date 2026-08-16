const branchService = require('../services/branchService');

const getBranches = async (req, res) => {
  try {
    const branches = await branchService.getBranches(req);
    return res.status(200).json({ success: true, branches });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const createBranch = async (req, res) => {
  try {
    const branch = await branchService.createBranch(req, req.body || {});
    return res.status(201).json({ success: true, branch });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const updateBranch = async (req, res) => {
  try {
    const branch = await branchService.updateBranch(req, req.params.branchId, req.body || {});
    return res.status(200).json({ success: true, branch });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const deactivateBranch = async (req, res) => {
  try {
    const branch = await branchService.deactivateBranch(req, req.params.branchId);
    return res.status(200).json({ success: true, branch });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { getBranches, createBranch, updateBranch, deactivateBranch };
