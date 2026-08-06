const path = require('node:path');
require('dotenv').config();

const root = path.resolve(__dirname, '../..');

module.exports = Object.freeze({
  host: process.env.POS_SERVICE_HOST || '127.0.0.1',
  port: Number(process.env.POS_SERVICE_PORT || 4782),
  databasePath: path.resolve(root, process.env.POS_DATABASE_PATH || './data/pos.sqlite'),
  deviceId: process.env.POS_DEVICE_ID || null,
  storeId: process.env.POS_STORE_ID || null,
  enterpriseApiUrl: process.env.ENTERPRISE_API_URL || null,
  logLevel: process.env.LOG_LEVEL || 'info'
});
