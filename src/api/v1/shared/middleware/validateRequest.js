const validateRequest = (schema, source = 'body') => (req, res, next) => {
  const payload = req[source];
  const { error, value } = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.details.map((item) => ({
          field: item.path.join('.'),
          message: item.message,
        })),
      },
    });
  }

  req[source] = value;
  return next();
};

module.exports = { validateRequest };
