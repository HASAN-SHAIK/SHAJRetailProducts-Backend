const express = require('express');
const { register, login, getLogin, logout } = require('../controllers/authController');
const { authTenantMiddleware } = require('../middleware/authTenant');
const router = express.Router();


router.post('/register',register);
router.post('/login',login);
router.get('/getLogin', authTenantMiddleware, getLogin);
router.post('/logout', authTenantMiddleware, logout);

module.exports = router;    
