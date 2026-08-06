const express = require('express');
const {
  getSettings,
  getApplicationSettings,
  updateApplicationSettings,
} = require('../controllers/settingsController');

const router = express.Router();

router.get('/', getSettings);
router.get('/application', getApplicationSettings);
router.put('/application', updateApplicationSettings);

module.exports = router;
