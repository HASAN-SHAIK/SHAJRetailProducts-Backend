const { AppError } = require('../errors/AppError');
const { sendError } = require('../dto/apiResponse');
const { apiLogger } = require('../logger');

const apiErrorHandler = (err, req, res, next) => {
  if (!err) return next();

  const statusCode = err.statusCode || err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Internal Server Error';

  if (!(err instanceof AppError) && statusCode >= 500) {
    apiLogger.error('API v1 unhandled error', {
      path: req.originalUrl,
      method: req.method,
      message: err.message,
      stack: err.stack,
    });
  }

  return sendError(res, statusCode, code, message, err.details || null);
};

module.exports = { apiErrorHandler };
