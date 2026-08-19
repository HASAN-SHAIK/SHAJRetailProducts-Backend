require('dotenv').config();
const { Pool } = require('pg');
const { getEnvPassword, getPoolTuning, attachQueryTimer, logPoolError } = require('./poolUtils');
const { resolveDatabaseSslConfig } = require('../security/databaseTlsPolicy');

const ssl = resolveDatabaseSslConfig();
const poolConfig = process.env.MASTER_DATABASE_URL
  ? {
      connectionString: process.env.MASTER_DATABASE_URL,
      ssl
    }
  : {
      user: process.env.MASTER_DB_USER || process.env.DB_USER,
      host: process.env.MASTER_DB_HOST || process.env.DB_HOST,
      database: process.env.MASTER_DB_NAME || 'masterdb',
      password: getEnvPassword(process.env.MASTER_DB_PASSWORD, process.env.DB_PASSWORD, 'MASTER_DB_PASSWORD/DB_PASSWORD'),
      port: process.env.MASTER_DB_PORT || process.env.DB_PORT || 5432,
      ssl
    };

const resolveMasterPoolMax = () => {
  const raw = process.env.MASTER_DB_POOL_MAX ?? process.env.DB_POOL_MAX;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 5;
};

const tunedConfig = { ...poolConfig, max: resolveMasterPoolMax(), ...getPoolTuning('MASTER_DB') };
let masterPool;

const getMasterPool = () => {
  if (masterPool) return masterPool;
  masterPool = attachQueryTimer(new Pool(tunedConfig), 'master');
  masterPool.on('error', (err) => {
    logPoolError('master', err);
  });
  console.log('Master Pool Created');
  return masterPool;
};

const exportedPool = getMasterPool();
module.exports = exportedPool;
module.exports.getMasterPool = getMasterPool;
