const express = require('express');
const { getBranches, createBranch } = require('../controllers/branchController');

const router = express.Router();

router.get('/', getBranches);
router.post('/', createBranch);

module.exports = router;
