const winston = require('winston');

const apiLogger = winston.createLogger({
  level: process.env.API_LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'shaj-api-v1' },
  transports: [new winston.transports.Console()],
});

module.exports = { apiLogger };
