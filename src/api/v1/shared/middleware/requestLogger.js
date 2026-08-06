const { apiLogger } = require('../logger');

const requestLogger = (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    apiLogger.info('API v1 request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - started,
      tenant_id: req.tenant_id || null,
      user_id: req.user?.user_id || null,
    });
  });
  next();
};

module.exports = { requestLogger };
