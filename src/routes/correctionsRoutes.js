const express = require('express');
const { createCorrection, listCorrections } = require('../controllers/correctionsController');

const router = express.Router();

router.post('/', createCorrection);
router.get('/', listCorrections);

module.exports = router;
