const express = require('express');
const { create, update, list, getById, ledger, addPaymentEntry } = require('./controller');

const router = express.Router();

router.post('/', create);
router.get('/', list);
router.get('/:id', getById);
router.put('/:id', update);
router.get('/:id/ledger', ledger);
router.post('/:id/payments', addPaymentEntry);

module.exports = router;
