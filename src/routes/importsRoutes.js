const express = require('express');
const isAdmin = require('../middleware/isAdmin');
const { importOffline } = require('../controllers/imports.controller');

const router = express.Router();

router.post('/', isAdmin, importOffline);

module.exports = router;
