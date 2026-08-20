const DEFAULT_NON_PRODUCTION_INTAKE_EMAIL = 'shajnextgen@gmail.com';

const normalizeEnvironment = (value) => String(value || '').trim().toLowerCase();

const isValidEmail = (value) =>
  typeof value === 'string' &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const resolveSupportIntakeEmail = ({ env = process.env, environment } = {}) => {
  const appEnvironment = normalizeEnvironment(
    environment || env.APP_ENVIRONMENT || env.NODE_ENV || 'development'
  );
  const configured = String(env.SUPPORT_CASE_INTAKE_EMAIL || '').trim();

  if (configured) {
    if (!isValidEmail(configured)) {
      const error = new Error('SUPPORT_CASE_INTAKE_EMAIL must be a valid email address');
      error.code = 'SUPPORT_CASE_INTAKE_EMAIL_INVALID';
      throw error;
    }
    return configured;
  }

  if (appEnvironment === 'production') {
    const error = new Error('SUPPORT_CASE_INTAKE_EMAIL is required in production');
    error.code = 'SUPPORT_CASE_INTAKE_EMAIL_REQUIRED';
    throw error;
  }

  return DEFAULT_NON_PRODUCTION_INTAKE_EMAIL;
};

module.exports = {
  DEFAULT_NON_PRODUCTION_INTAKE_EMAIL,
  resolveSupportIntakeEmail,
};
