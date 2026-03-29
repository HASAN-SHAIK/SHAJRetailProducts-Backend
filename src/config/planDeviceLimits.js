const PLAN_DEVICE_LIMITS = {
  basic: 1,
  pro: 3,
  premium: 5,
  enterprise: null
};

const normalizePlan = (planType) => {
  return (planType || 'basic').toString().trim().toLowerCase();
};

const resolvePlanDeviceLimit = (planType) => {
  const plan = normalizePlan(planType);
  if (Object.prototype.hasOwnProperty.call(PLAN_DEVICE_LIMITS, plan)) {
    return PLAN_DEVICE_LIMITS[plan];
  }
  return PLAN_DEVICE_LIMITS.basic;
};

module.exports = { PLAN_DEVICE_LIMITS, normalizePlan, resolvePlanDeviceLimit };
