require('dotenv').config();
const { Pool } = require('pg');
const { getEnvPassword, getPoolTuning, attachQueryTimer } = require('./poolUtils');

const adminDbName = process.env.MASTER_DB_NAME || process.env.DB_NAME || 'postgres';

const poolConfig = (process.env.ADMIN_DATABASE_URL || process.env.MASTER_DATABASE_URL)
    ? {
        connectionString: process.env.ADMIN_DATABASE_URL || process.env.MASTER_DATABASE_URL,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
      }
  : {
      user: process.env.MASTER_DB_USER || process.env.DB_USER,
      host: process.env.MASTER_DB_HOST || process.env.DB_HOST,
      database: adminDbName,
      password: getEnvPassword(process.env.MASTER_DB_PASSWORD, process.env.DB_PASSWORD, 'MASTER_DB_PASSWORD/DB_PASSWORD'),
      port: process.env.MASTER_DB_PORT || process.env.DB_PORT || 5432,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

const resolveAdminPoolMax = () => {
  const raw = process.env.ADMIN_DB_POOL_MAX ?? process.env.MASTER_DB_POOL_MAX ?? process.env.DB_POOL_MAX;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 5;
};

const tunedConfig = {
  ...poolConfig,
  max: resolveAdminPoolMax(),
  ...getPoolTuning('ADMIN_DB'),
};

const adminPool = attachQueryTimer(new Pool(tunedConfig), 'admin');

adminPool.on('error', (err) => {
  console.error('Admin DB pool error:', err);
});

module.exports = adminPool;
