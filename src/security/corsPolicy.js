const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const DEFAULT_MOBILE_ORIGINS = Object.freeze([
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
  'ionic://localhost',
]);

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
      const normalized = normalizeOrigin(origin);
      if (!origin || allowAllOrigins || allowed.has(normalized) || DEFAULT_MOBILE_ORIGINS.includes(normalized)) {
        callback(null, true);
        return;
      }
      console.warn(`[CORS] Origin rejected: "${origin}". Allowed origins:`, Array.from(allowed));
      const corsError = new Error('Not allowed by CORS');
      corsError.status = 403;
      corsError.statusCode = 403;
      corsError.code = 'CORS_NOT_ALLOWED';
      callback(corsError);
    },
  };
};

module.exports = {
  buildAllowedOrigins,
  createCorsOptions,
};
