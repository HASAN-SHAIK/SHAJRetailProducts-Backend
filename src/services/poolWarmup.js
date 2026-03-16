const masterPool = require('../db/masterPool');
const { getAllTenantPoolEntries } = require('../db/tenantPool');

const warmPool = async (pool, label) => {
  if (!pool) return;
  try {
    await pool.query('SELECT 1');
    console.log(`[WARM] ${label} warmed`);
  } catch (error) {
    console.error(`[WARM] ${label} warm failed`);
  }
};

const startPoolWarmup = () => {
  if (startPoolWarmup.timer) return startPoolWarmup.timer;
  const intervalMs = 4 * 60 * 1000;

  const tick = async () => {
    await warmPool(masterPool, 'Master DB');
    const tenantEntries = getAllTenantPoolEntries();
    for (const entry of tenantEntries) {
      if (!entry?.pool) continue;
      await warmPool(entry.pool, `Tenant ${entry.tenantId}`);
    }
  };

  tick().catch(() => null);
  const timer = setInterval(() => {
    tick().catch(() => null);
  }, Math.max(30_000, intervalMs));
  timer.unref?.();
  startPoolWarmup.timer = timer;
  return timer;
};

module.exports = { startPoolWarmup };
