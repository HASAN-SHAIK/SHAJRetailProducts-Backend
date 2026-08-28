const express = require('express');
const controller = require('./staff.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListStaff, controller.listStaff);
router.get('/salary', controller.requireTenantUser, controller.validateListStaff, controller.listSalaries);
router.post('/salary', controller.requireAdmin, controller.createSalary);
router.put('/salary/:salaryId', controller.requireAdmin, controller.validateSalaryId, controller.updateSalary);
router.delete('/salary/:salaryId', controller.requireAdmin, controller.validateSalaryId, controller.deleteSalary);
router.get('/performance', controller.requireTenantUser, controller.validateListStaff, controller.getPerformance);
router.get('/:id', controller.requireTenantUser, controller.validateStaffId, controller.getStaff);
router.post('/', controller.requireAdmin, controller.validateCreateStaff, controller.createStaff);
router.put('/:id', controller.requireAdmin, controller.validateStaffId, controller.validateUpdateStaff, controller.updateStaff);
router.delete('/:id', controller.requireAdmin, controller.validateStaffId, controller.deleteStaff);

module.exports = router;
