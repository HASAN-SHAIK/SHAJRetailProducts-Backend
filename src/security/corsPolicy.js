const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const buildAllowedOrigins = ({ rawCorsOrigins, fallbackOrigins = [] }) => {
  const configured = rawCorsOrigins
    ? String(rawCorsOrigins).split(',')
    : fallbackOrigins;
  return configured.map(normalizeOrigin).filter(Boolean);
};

const createCorsOptions = ({ environment, rawCorsOrigins, fallbackOrigins = [] }) => {
  const allowedOrigins = buildAllowedOrigins({ rawCorsOrigins, fallbackOrigins });
  const production = String(environment || '').toLowerCase() === 'production';
  const wildcardConfigured = allowedOrigins.includes('*');

  if (production && wildcardConfigured) {
    throw new Error('CORS_ORIGINS must not contain * in production');
  }

  const allowAllOrigins = !production && wildcardConfigured;
  const allowed = new Set(allowedOrigins.filter((origin) => origin !== '*'));

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowAllOrigins || allowed.has(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
  };
};

module.exports = {
  buildAllowedOrigins,
  createCorsOptions,
};
