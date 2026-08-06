const express = require('express');
const { register, login, refresh, getLogin, logout } = require('../controllers/authController');
const { authTenantMiddleware } = require('../middleware/authTenant');
const router = express.Router();


router.post('/register',register);
router.post('/login',login);
router.post('/refresh', refresh);
router.get('/getLogin', authTenantMiddleware, getLogin);
router.post('/logout', logout);

module.exports = router;    
