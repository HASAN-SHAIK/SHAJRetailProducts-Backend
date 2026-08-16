const express = require('express');
const router = express.Router();
const { getBranches, createBranch, updateBranch, deactivateBranch } = require('../controllers/branchController');
const isAdmin = require('../middleware/isAdmin');
const {
  getBranchDevices,
  deactivateBranchDevice,
  updateBranchPlan,
  registerDeviceOnBranch,
} = require('../controllers/branchDeviceController');

router.get('/', getBranches);
router.post('/', isAdmin, createBranch);
router.patch('/:branchId', isAdmin, updateBranch);
router.delete('/:branchId', isAdmin, deactivateBranch);
router.get('/:branchId/devices', isAdmin, getBranchDevices);
router.post('/:branchId/devices/register', isAdmin, registerDeviceOnBranch);
router.delete('/:branchId/devices/:deviceId', isAdmin, deactivateBranchDevice);
router.put('/:branchId/plan', isAdmin, updateBranchPlan);

module.exports = router;
