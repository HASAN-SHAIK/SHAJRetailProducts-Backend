const express = require('express');
const { createSalary, listSalaries, updateSalary, deleteSalary } = require('../controllers/salaryController');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.post('/', isAdmin, createSalary);
router.get('/', isAdmin, listSalaries);
router.put('/:id', isAdmin, updateSalary);
router.delete('/:id', isAdmin, deleteSalary);

module.exports = router;
