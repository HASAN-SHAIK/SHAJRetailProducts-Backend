const express = require('express');
const { createSalary, listSalaries, updateSalary, deleteSalary } = require('../controllers/salaryController');

const router = express.Router();

router.post('/', createSalary);
router.get('/', listSalaries);
router.put('/:id', updateSalary);
router.delete('/:id', deleteSalary);

module.exports = router;
