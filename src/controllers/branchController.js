const branchService = require('../services/branchService');

const getBranches = async (req, res, next) => {
  try {
    const branches = await branchService.getBranches(req);
    return res.status(200).json({ success: true, data: branches });
  } catch (error) {
    return next(error);
  }
};

const createBranch = async (req, res, next) => {
  try {
    const branch = await branchService.createBranch(req, req.body || {});
    return res.status(201).json({ success: true, data: branch });
  } catch (error) {
    return next(error);
  }
};

const updateBranch = async (req, res, next) => {
  try {
    const branch = await branchService.updateBranch(req, req.params.branchId, req.body || {});
    return res.status(200).json({ success: true, data: branch });
  } catch (error) {
    return next(error);
  }
};

const deactivateBranch = async (req, res, next) => {
  try {
    const branch = await branchService.deactivateBranch(req, req.params.branchId);
    return res.status(200).json({ success: true, data: branch });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getBranches, createBranch, updateBranch, deactivateBranch };
