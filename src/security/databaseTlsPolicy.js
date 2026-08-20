const normalizeEnvironment = (value) => String(value || 'development').trim().toLowerCase();

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const error = new Error('Database TLS boolean configuration must be true or false.');
  error.code = 'INVALID_DB_TLS_CONFIG';
  throw error;
};

const resolveDatabaseSslConfig = (env = process.env) => {
  const enabled = parseBoolean(env.DB_SSL, false);
  if (!enabled) return false;

  const environment = normalizeEnvironment(env.APP_ENVIRONMENT || env.NODE_ENV);
  const rejectUnauthorized = parseBoolean(env.DB_SSL_REJECT_UNAUTHORIZED, true);

  if (environment === 'production' && !rejectUnauthorized) {
    const error = new Error('Production database TLS must verify the PostgreSQL server certificate.');
    error.code = 'INSECURE_DB_TLS_NOT_ALLOWED';
    throw error;
  }

  const ssl = { rejectUnauthorized };
  const ca = typeof env.DB_SSL_CA === 'string' ? env.DB_SSL_CA.trim() : '';
  if (ca) {
    ssl.ca = ca.replace(/\\n/g, '\n');
  }

  return ssl;
};

module.exports = {
  parseBoolean,
  resolveDatabaseSslConfig,
};
