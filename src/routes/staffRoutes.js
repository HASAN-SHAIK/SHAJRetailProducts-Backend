const express = require('express');
const { createStaff, listStaff, updateStaff, deleteStaff } = require('../controllers/staffController');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.post('/', isAdmin, createStaff);
router.get('/', isAdmin, listStaff);
router.put('/:id', isAdmin, updateStaff);
router.delete('/:id', isAdmin, deleteStaff);

module.exports = router;
