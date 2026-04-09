const express = require('express');
const { createStaff, listStaff, updateStaff, deleteStaff } = require('../controllers/staffController');

const router = express.Router();

router.post('/', createStaff);
router.get('/', listStaff);
router.put('/:id', updateStaff);
router.delete('/:id', deleteStaff);

module.exports = router;
