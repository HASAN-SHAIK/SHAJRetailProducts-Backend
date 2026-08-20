const { jsonError } = require('../utils/responses');

const errorHandler = (err, req, res, next) => {
  if (!err) return next();

  const status = err.statusCode || err.status || 500;
  if (status >= 500) {
    return jsonError(res, status, 'INTERNAL_ERROR', 'Internal Server Error');
  }

  const code = err.code || 'REQUEST_FAILED';
  const message = err.message || 'Request failed';
  return jsonError(res, status, code, message);
};

module.exports = { errorHandler };
