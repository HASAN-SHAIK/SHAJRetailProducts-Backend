const express = require('express');
const { createReturn, listReturns, getReturnItems } = require('../controllers/returnsController');

const router = express.Router();

router.post('/', createReturn);
router.get('/', listReturns);
router.get('/:id', getReturnItems);

module.exports = router;
