const { runConsistencyForAllActiveTenants } = require('./stockConsistencyService');

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

const startStockConsistencyJob = () => {
  if (startStockConsistencyJob.timer) return startStockConsistencyJob.timer;
  const intervalMs = Math.max(
    60_000,
    Number(process.env.STOCK_CONSISTENCY_JOB_MS || DEFAULT_INTERVAL_MS)
  );
  const enabled = String(process.env.STOCK_CONSISTENCY_JOB_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return null;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runConsistencyForAllActiveTenants();
      console.log(
        `[STOCK_CONSISTENCY] tenants=${summary.total_tenants} completed=${summary.completed_tenants} failed=${summary.failed_tenants} mismatches=${summary.mismatch_count} healed=${summary.healed_count}`
      );
    } catch (error) {
      console.error('[STOCK_CONSISTENCY] scheduled run failed:', error.message || error);
    } finally {
      running = false;
    }
  };

  tick().catch(() => null);
  const timer = setInterval(() => {
    tick().catch(() => null);
  }, intervalMs);
  timer.unref?.();
  startStockConsistencyJob.timer = timer;
  return timer;
};

module.exports = { startStockConsistencyJob };
