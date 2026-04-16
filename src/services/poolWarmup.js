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

const isWarmupEnabled = () => {
  const raw = String(process.env.DB_WARMUP_ENABLED ?? 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
};

const resolveWarmupIntervalMs = () => {
  const parsed = Number(process.env.DB_WARMUP_INTERVAL_MS || 4 * 60 * 1000);
  if (!Number.isFinite(parsed)) return 4 * 60 * 1000;
  return Math.max(30_000, parsed);
};

const startPoolWarmup = () => {
  if (!isWarmupEnabled()) {
    console.log('[WARM] DB warmup disabled (DB_WARMUP_ENABLED=false)');
    return null;
  }
  if (startPoolWarmup.timer) return startPoolWarmup.timer;
  const intervalMs = resolveWarmupIntervalMs();

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
  }, intervalMs);
  timer.unref?.();
  startPoolWarmup.timer = timer;
  console.log(`[WARM] DB warmup started (interval=${intervalMs}ms)`);
  return timer;
};

module.exports = { startPoolWarmup };
