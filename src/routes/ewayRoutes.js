const express = require('express');
const { createOrUpdate, listEway, deleteEway } = require('../controllers/ewayController');

const router = express.Router();

router.post('/', createOrUpdate);
router.put('/:id', createOrUpdate);
router.get('/', listEway);
router.delete('/:id', deleteEway);

module.exports = router;
