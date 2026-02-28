require('dotenv').config();
const { Pool } = require('pg');
const { getEnvPassword, attachQueryTimer } = require('./poolUtils');

const pools = new Map();

const buildTenantPoolConfig = (database) => {
  if (process.env.TENANT_DATABASE_URL_TEMPLATE) {
    const connectionString = process.env.TENANT_DATABASE_URL_TEMPLATE.replace('{db}', database);
    return {
      connectionString,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };
  }

  return {
    user: process.env.TENANT_DB_USER || process.env.DB_USER,
    host: process.env.TENANT_DB_HOST || process.env.DB_HOST,
    database,
    password: getEnvPassword(process.env.TENANT_DB_PASSWORD, process.env.DB_PASSWORD, 'TENANT_DB_PASSWORD/DB_PASSWORD'),
    port: process.env.TENANT_DB_PORT || process.env.DB_PORT || 5432,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
};

const getTenantPool = (database) => {
  if (!database) {
    throw new Error('Tenant database name is required');
  }
  if (pools.has(database)) {
    return pools.get(database);
  }
  console.log(`Creating new pool for tenant database: ${database}`);
  const pool = attachQueryTimer(new Pool(buildTenantPoolConfig(database)), `tenant:${database}`);
  pool.on('error', (err) => {
    console.error(`Tenant DB pool error (${database}):`, err);
  });
  pools.set(database, pool);
  return pool;
};

const closeAllTenantPools = async () => {
  const closing = [];
  for (const pool of pools.values()) {
    closing.push(pool.end());
  }
  await Promise.allSettled(closing);
  pools.clear();
};

module.exports = { getTenantPool, closeAllTenantPools };
