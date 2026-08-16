const express = require('express');
const { getBranches, createBranch, updateBranch, deactivateBranch } = require('../controllers/branchController');
const {
  getBranchDevices,
  deactivateBranchDevice,
  updateBranchPlan,
  registerDeviceOnBranch
} = require('../controllers/branchDeviceController');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.get('/', getBranches);
router.post('/', isAdmin, createBranch);
router.patch('/:branchId', isAdmin, updateBranch);
router.delete('/:branchId', isAdmin, deactivateBranch);
router.get('/:branchId/devices', isAdmin, getBranchDevices);
router.post('/:branchId/devices/register', isAdmin, registerDeviceOnBranch);
router.patch('/:branchId/devices/:deviceId/deactivate', isAdmin, deactivateBranchDevice);
router.patch('/:branchId/plan', isAdmin, updateBranchPlan);

module.exports = router;
