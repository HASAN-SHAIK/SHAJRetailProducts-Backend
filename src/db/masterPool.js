require('dotenv').config();
const { Pool } = require('pg');
const { getEnvPassword, getPoolTuning, attachQueryTimer } = require('./poolUtils');

const poolConfig = process.env.MASTER_DATABASE_URL
  ? {
      connectionString: process.env.MASTER_DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    }
  : {
      user: process.env.MASTER_DB_USER || process.env.DB_USER,
      host: process.env.MASTER_DB_HOST || process.env.DB_HOST,
      database: process.env.MASTER_DB_NAME || 'masterdb',
      password: getEnvPassword(process.env.MASTER_DB_PASSWORD, process.env.DB_PASSWORD, 'MASTER_DB_PASSWORD/DB_PASSWORD'),
      port: process.env.MASTER_DB_PORT || process.env.DB_PORT || 5432,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

const tunedConfig = { ...poolConfig, ...getPoolTuning('MASTER_DB') };
let masterPool;

const getMasterPool = () => {
  if (masterPool) return masterPool;
  masterPool = attachQueryTimer(new Pool(tunedConfig), 'master');
  masterPool.on('error', (err) => {
    console.error('Master DB pool error:', err);
  });
  console.log('Master Pool Created');
  return masterPool;
};

const exportedPool = getMasterPool();
module.exports = exportedPool;
module.exports.getMasterPool = getMasterPool;
