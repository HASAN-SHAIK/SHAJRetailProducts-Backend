const { jsonError } = require('../utils/responses');

const errorHandler = (err, req, res, next) => {
  if (!err) return next();
  const status = err.statusCode || err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Internal Server Error';
  return jsonError(res, status, code, message);
};

module.exports = { errorHandler };
