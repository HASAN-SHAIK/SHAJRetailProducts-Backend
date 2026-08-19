const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
};

const buildPuppeteerLaunchOptions = ({ environment, allowNoSandbox }) => {
  const production = environment === 'production';
  const insecureNoSandbox = parseBoolean(allowNoSandbox, !production);

  if (production && insecureNoSandbox) {
    const error = new Error('PUPPETEER_ALLOW_NO_SANDBOX cannot be enabled in production');
    error.code = 'UNSAFE_PUPPETEER_SANDBOX_CONFIG';
    throw error;
  }

  return {
    headless: 'new',
    args: insecureNoSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  };
};

module.exports = {
  buildPuppeteerLaunchOptions,
};
