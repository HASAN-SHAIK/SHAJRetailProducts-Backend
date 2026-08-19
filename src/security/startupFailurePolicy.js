const logStartupFailure = ({ environment, error, logger = console } = {}) => {
  if (environment === 'production') {
    logger.error('Failed to start server: INTERNAL_STARTUP_ERROR');
    return;
  }

  logger.error('Failed to start server:', error?.message || error || 'unknown_error');
};

module.exports = { logStartupFailure };
