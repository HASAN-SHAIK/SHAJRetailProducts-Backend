const Joi = require('joi');
const { jsonError, jsonOk } = require('../utils/responses');
const { sanitizeDeviceContext } = require('../utils/branchDeviceLicensing');
const {
  getOnboardingPlans,
  onboardCompany,
  getOnboardingStatus,
} = require('../services/onboardingService');

const createCompanySchema = Joi.object({
  shop_name: Joi.string().trim().min(2).max(120).required(),
  owner_name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().email().max(200).required(),
  mobile: Joi.string().trim().pattern(/^[0-9+\-\s]{7,20}$/).required().messages({
    'string.pattern.base': 'mobile must be 7 to 20 digits',
  }),
  password: Joi.string().min(8).max(128).required(),
  company_code: Joi.string().trim().lowercase().pattern(/^[a-z0-9-]{3,48}$/).allow('', null),
  gst_number: Joi.string().trim().uppercase().max(20).allow('', null),
  gst_mode: Joi.string().trim().uppercase().valid('INCLUSIVE', 'EXCLUSIVE').default('INCLUSIVE'),
  address_line: Joi.string().trim().max(255).allow('', null),
  city: Joi.string().trim().max(100).allow('', null),
  state: Joi.string().trim().max(100).allow('', null),
  pincode: Joi.string().trim().max(16).allow('', null),
  plan_type: Joi.string().trim().lowercase().valid('basic', 'pro', 'premium').default('basic'),
  store_name: Joi.string().trim().min(2).max(120).allow('', null),
  store_number: Joi.string().trim().uppercase().max(32).allow('', null),
  store_location: Joi.string().trim().max(200).allow('', null),
  captcha_token: Joi.string().trim().allow('', null),
});

const listPlansHandler = async (_req, res) => {
  try {
    const plans = await getOnboardingPlans();
    return jsonOk(res, { plans });
  } catch (error) {
    return jsonError(res, 500, 'PLANS_FETCH_FAILED', error.message || 'Failed to load plans');
  }
};

const createCompanyHandler = async (req, res) => {
  try {
    const { error, value } = createCompanySchema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
    });
    if (error) {
      return jsonError(res, 400, 'VALIDATION_ERROR', error.details[0]?.message || 'Invalid onboarding payload');
    }

    const { deviceId } = sanitizeDeviceContext(req);
    const result = await onboardCompany(value, { deviceId });

    return res.status(201).json({
      success: true,
      message: 'Company created and ready for store & POS onboarding',
      ...result,
    });
  } catch (error) {
    const status = error?.status || (error?.code === '23505' ? 409 : 500);
    const code = error?.code && typeof error.code === 'string' && !/^\d+$/.test(error.code)
      ? error.code
      : 'COMPANY_ONBOARDING_FAILED';
    return jsonError(res, status, code, error.message || 'Failed to create company');
  }
};

const getOnboardingStatusHandler = async (req, res) => {
  try {
    if (!req.tenant || !req.tenantPool) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Tenant context unavailable');
    }
    const status = await getOnboardingStatus({
      tenant: req.tenant,
      tenantPool: req.tenantPool,
    });
    return jsonOk(res, status);
  } catch (error) {
    return jsonError(res, 500, 'ONBOARDING_STATUS_FAILED', error.message || 'Failed to load onboarding status');
  }
};

module.exports = {
  listPlansHandler,
  createCompanyHandler,
  getOnboardingStatusHandler,
};
