const express = require('express');
const rateLimit = require('express-rate-limit');
const { adminLogin, adminMe, adminLogout, createAdmin } = require('../controllers/adminAuthController');
const { adminAuthMiddleware } = require('../middleware/adminAuthMiddleware');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many login attempts. Please try again later.'
  }
});

router.post('/login', loginLimiter, adminLogin);
router.get('/me', adminAuthMiddleware, adminMe);
router.post('/admins', adminAuthMiddleware, createAdmin);
router.post('/logout', adminAuthMiddleware, adminLogout);

module.exports = router;
