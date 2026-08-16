const express = require('express');
const {
  getSettings,
  getApplicationSettings,
  updateApplicationSettings,
} = require('../controllers/settingsController');
const { requirePermission } = require('../middleware/requirePermission');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.get('/', requirePermission('settings:read'), getSettings);
router.get('/application', requirePermission('settings:read'), getApplicationSettings);
router.put('/application', isAdmin, updateApplicationSettings);

module.exports = router;
