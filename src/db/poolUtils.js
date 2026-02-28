const normalizePassword = (value, label) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`${label} must be a string. Got ${typeof value}. Check your .env or config.`);
};

const getEnvPassword = (primary, fallback, label) => {
  const value = primary ?? fallback;
  return normalizePassword(value, label);
};

module.exports = { normalizePassword, getEnvPassword };
