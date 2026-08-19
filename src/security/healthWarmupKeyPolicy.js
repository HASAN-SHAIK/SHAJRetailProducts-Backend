const crypto = require('crypto');

const safeSecretEquals = (expected, provided) => {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

const isHealthWarmupAuthorized = ({ environment, expectedKey, headerKey, queryKey }) => {
  if (typeof expectedKey !== 'string' || expectedKey.length === 0) return false;

  // Query-string secrets are routinely captured by proxies, access logs and
  // browser history. Production accepts the privileged warmup key only through
  // the dedicated header. Non-production keeps the legacy query path for local
  // tooling compatibility.
  const providedKey = environment === 'production'
    ? headerKey
    : (headerKey || queryKey);

  return safeSecretEquals(expectedKey, providedKey);
};

module.exports = {
  isHealthWarmupAuthorized,
  safeSecretEquals,
};
