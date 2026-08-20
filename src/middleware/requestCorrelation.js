const crypto = require('crypto');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const chooseRequestId = (value) => {
  if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) {
    return value;
  }
  return crypto.randomUUID();
};

const requestCorrelationMiddleware = (req, res, next) => {
  const requestId = chooseRequestId(req.get('x-request-id'));
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  res.set('X-Request-ID', requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info('http_request', {
      request_id: requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Number(durationMs.toFixed(3)),
    });
  });

  next();
};

module.exports = { requestCorrelationMiddleware, chooseRequestId, REQUEST_ID_PATTERN };
