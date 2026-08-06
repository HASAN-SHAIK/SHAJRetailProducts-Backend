const logger = require('../../../utils/logger');

const withContext = (context = {}) => ({
  info: (message, meta = {}) => logger.info(message, { ...context, ...meta }),
  warn: (message, meta = {}) => logger.warn(message, { ...context, ...meta }),
  error: (message, meta = {}) => logger.error(message, { ...context, ...meta }),
});

const syncLogger = withContext({ component: 'sync-messaging' });

module.exports = {
  syncLogger,
  withContext,
};
