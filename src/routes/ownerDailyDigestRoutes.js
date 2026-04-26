const express = require('express');
const isAdmin = require('../middleware/isAdmin');
const {
  getOwnerDailyDigestSettings,
  updateOwnerDailyDigestSettings,
  previewOwnerDailyDigest,
  sendOwnerDailyDigestNow,
  sendOwnerDailyDigestTestEmail,
} = require('../controllers/tenant/ownerDailyDigestController');

const router = express.Router();

router.get('/settings', isAdmin, getOwnerDailyDigestSettings);
router.put('/settings', isAdmin, updateOwnerDailyDigestSettings);
router.get('/preview', isAdmin, previewOwnerDailyDigest);
router.post('/send-now', isAdmin, sendOwnerDailyDigestNow);
router.post('/send-test-email', isAdmin, sendOwnerDailyDigestTestEmail);

module.exports = router;
