const express = require('express');
const Joi = require('joi');
const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { authTenantMiddleware } = require('../../../../middleware/authTenant');
const { login, refresh, getLogin, logout } = require('../../../../controllers/authController');

const router = express.Router();

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(1).required(),
  branch_id: Joi.string().uuid().allow(null, ''),
  remember_me: Joi.boolean().optional(),
});

const wrapLegacy = (handler) =>
  asyncHandler(async (req, res) => {
    await handler(req, res);
  });

// V1 tenant user creation is an authenticated tenant-admin capability, not a
// public authentication endpoint. Keep only session lifecycle routes here.
router.post('/login', validateRequest(loginSchema), wrapLegacy(login));
router.post('/refresh', wrapLegacy(refresh));
router.get('/me', authTenantMiddleware, wrapLegacy(getLogin));
router.post('/logout', wrapLegacy(logout));

router.get('/health', (req, res) => sendSuccess(res, { status: 'ok', version: 'v1' }));

module.exports = router;
