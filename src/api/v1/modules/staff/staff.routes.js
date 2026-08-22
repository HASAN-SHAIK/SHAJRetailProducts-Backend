const express = require('express');
const controller = require('./staff.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListStaff, controller.listStaff);
router.get('/:id', controller.requireTenantUser, controller.validateStaffId, controller.getStaff);
router.post('/', controller.requireAdmin, controller.validateCreateStaff, controller.createStaff);
router.put('/:id', controller.requireAdmin, controller.validateStaffId, controller.validateUpdateStaff, controller.updateStaff);
router.delete('/:id', controller.requireAdmin, controller.validateStaffId, controller.deleteStaff);

module.exports = router;
