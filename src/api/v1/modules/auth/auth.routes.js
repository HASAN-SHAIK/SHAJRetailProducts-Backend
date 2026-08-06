const express = require('express');
const Joi = require('joi');
const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { authTenantMiddleware } = require('../../../../middleware/authTenant');
const { register, login, refresh, getLogin, logout } = require('../../../../controllers/authController');

const router = express.Router();

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(1).required(),
  branch_id: Joi.string().uuid().allow(null, ''),
  remember_me: Joi.boolean().optional(),
});

const registerSchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('admin', 'staff').default('staff'),
});

const wrapLegacy = (handler) =>
  asyncHandler(async (req, res) => {
    await handler(req, res);
  });

router.post('/register', validateRequest(registerSchema), wrapLegacy(register));
router.post('/login', validateRequest(loginSchema), wrapLegacy(login));
router.post('/refresh', wrapLegacy(refresh));
router.get('/me', authTenantMiddleware, wrapLegacy(getLogin));
router.post('/logout', wrapLegacy(logout));

router.get('/health', (req, res) => sendSuccess(res, { status: 'ok', version: 'v1' }));

module.exports = router;
