const { runOwnerDigestForAllActiveTenants } = require('./ownerDailyDigest.service');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

const startOwnerDailyDigestJob = () => {
  if (startOwnerDailyDigestJob.timer) return startOwnerDailyDigestJob.timer;
  const enabled =
    String(process.env.OWNER_DIGEST_JOB_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return null;

  const intervalMs = Math.max(
    60_000,
    Number(process.env.OWNER_DIGEST_JOB_MS || DEFAULT_INTERVAL_MS)
  );

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runOwnerDigestForAllActiveTenants();
      console.log(
        `[OWNER_DIGEST] tenants=${summary.total_tenants} processed=${summary.processed_tenants} failed=${summary.failed_tenants}`
      );
    } catch (error) {
      console.error('[OWNER_DIGEST] scheduled run failed:', error.message || error);
    } finally {
      running = false;
    }
  };

  tick().catch(() => null);
  const timer = setInterval(() => {
    tick().catch(() => null);
  }, intervalMs);
  timer.unref?.();
  startOwnerDailyDigestJob.timer = timer;
  return timer;
};

module.exports = { startOwnerDailyDigestJob };
