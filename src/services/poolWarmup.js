const masterPool = require('../db/masterPool');
const { getAllTenantPools } = require('../db/tenantPool');

const warmPool = async (pool, label) => {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.error(`Warmup failed for ${label}:`, error.message || error);
  }
};

const startPoolWarmup = () => {
  const enabled = process.env.DB_WARMUP_ENABLED === 'true';
  if (!enabled) return null;

  const intervalMs = Number(process.env.DB_WARMUP_INTERVAL_MS || 180_000);

  const tick = async () => {
    await warmPool(masterPool, 'master');
    const tenantPools = getAllTenantPools();
    await Promise.allSettled(
      tenantPools.map((pool) => warmPool(pool, 'tenant'))
    );
  };

  tick().catch(() => null);
  const timer = setInterval(() => {
    tick().catch(() => null);
  }, Math.max(30_000, intervalMs));
  timer.unref?.();
  return timer;
};

module.exports = { startPoolWarmup };
