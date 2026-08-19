require('dotenv').config();
const { Pool } = require('pg');
const { getEnvPassword, getPoolTuning, attachQueryTimer } = require('./poolUtils');
const { resolveDatabaseSslConfig } = require('../security/databaseTlsPolicy');

const pools = new Map();
let cleanupTimer = null;

const getIdleSettings = () => {
  const ttlMs = Number(process.env.TENANT_POOL_IDLE_EVICT_MS || 15 * 60 * 1000);
  const sweepMs = Number(process.env.TENANT_POOL_IDLE_SWEEP_MS || 5 * 60 * 1000);
  return { ttlMs, sweepMs };
};

const buildTenantPoolConfig = (database) => {
  const ssl = resolveDatabaseSslConfig();
  if (process.env.TENANT_DATABASE_URL_TEMPLATE) {
    const connectionString = process.env.TENANT_DATABASE_URL_TEMPLATE.replace('{db}', database);
    return {
      connectionString,
      ssl
    };
  }

  return {
    user: process.env.TENANT_DB_USER || process.env.DB_USER,
    host: process.env.TENANT_DB_HOST || process.env.DB_HOST,
    database,
    password: getEnvPassword(process.env.TENANT_DB_PASSWORD, process.env.DB_PASSWORD, 'TENANT_DB_PASSWORD/DB_PASSWORD'),
    port: process.env.TENANT_DB_PORT || process.env.DB_PORT || 5432,
    ssl
  };
};

const resolveTenantPoolMax = () => {
  const raw = process.env.TENANT_DB_POOL_MAX ?? process.env.DB_POOL_MAX;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 8;
};

const touch = (database) => {
  const entry = pools.get(database);
  if (entry) {
    entry.lastUsed = Date.now();
  }
};

const getTenantPool = (database) => {
  if (!database) {
    throw new Error('Tenant database name is required');
  }
  if (pools.has(database)) {
    touch(database);
    return pools.get(database).pool;
  }
  console.log(`Creating new pool for tenant database: ${database}`);
  const tunedConfig = {
    ...buildTenantPoolConfig(database),
    max: resolveTenantPoolMax(),
    ...getPoolTuning('TENANT_DB')
  };
  const pool = attachQueryTimer(new Pool(tunedConfig), `tenant:${database}`);
  pool.on('error', (err) => {
    console.error(`Tenant DB pool error (${database}):`, err);
  });
  pools.set(database, { pool, lastUsed: Date.now() });
  startIdleCleanup();
  return pool;
};

const getAllTenantPools = () => Array.from(pools.values()).map((entry) => entry.pool);
const getAllTenantPoolEntries = () =>
  Array.from(pools.entries()).map(([database, entry]) => ({
    tenantId: database,
    pool: entry.pool
  }));

const closeTenantPool = async (database) => {
  if (!database) return;
  const entry = pools.get(database);
  if (!entry) return;
  pools.delete(database);
  await entry.pool.end();
};

const closeIdleTenantPools = async () => {
  const now = Date.now();
  const { ttlMs } = getIdleSettings();
  const closing = [];
  for (const [database, entry] of pools.entries()) {
    if (now - entry.lastUsed > ttlMs) {
      closing.push(entry.pool.end());
      pools.delete(database);
    }
  }
  if (closing.length > 0) {
    await Promise.allSettled(closing);
  }
};

const startIdleCleanup = () => {
  if (cleanupTimer) return;
  const { sweepMs } = getIdleSettings();
  cleanupTimer = setInterval(() => {
    closeIdleTenantPools().catch((error) => {
      console.error('Failed to close idle tenant pools:', error);
    });
  }, Math.max(30_000, sweepMs));
  cleanupTimer.unref?.();
};

const closeAllTenantPools = async () => {
  const closing = [];
  for (const entry of pools.values()) {
    closing.push(entry.pool.end());
  }
  await Promise.allSettled(closing);
  pools.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
};

module.exports = {
  getTenantPool,
  getAllTenantPools,
  getAllTenantPoolEntries,
  closeTenantPool,
  closeAllTenantPools,
  closeIdleTenantPools
};
