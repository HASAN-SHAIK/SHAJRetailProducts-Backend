const express = require('express');
const { register, login, refresh, getLogin, logout } = require('../controllers/authController');
const { issueOfflineGrant } = require('../controllers/offlineGrantController');
const { issuePosSyncRecoveryGrant } = require('../controllers/posSyncRecoveryGrantController');
const { authTenantMiddleware } = require('../middleware/authTenant');
const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.get('/getLogin', authTenantMiddleware, getLogin);
router.post('/offline-grant', authTenantMiddleware, issueOfflineGrant);
router.post('/pos-sync-recovery-grant', authTenantMiddleware, issuePosSyncRecoveryGrant);
router.post('/logout', logout);

module.exports = router;
