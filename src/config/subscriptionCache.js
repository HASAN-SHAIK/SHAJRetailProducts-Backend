const cache = new Map();

const getTtlMs = () => Number(process.env.SUBSCRIPTION_CACHE_TTL_MS || 5 * 60 * 1000);

const getCachedSubscription = (tenantId) => {
  if (!tenantId) return null;
  const entry = cache.get(tenantId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(tenantId);
    return null;
  }
  return entry.value;
};

const setCachedSubscription = (tenantId, value) => {
  if (!tenantId) return;
  cache.set(tenantId, { value, expiresAt: Date.now() + getTtlMs() });
};

const clearCachedSubscription = (tenantId) => {
  if (!tenantId) return;
  cache.delete(tenantId);
};

module.exports = { getCachedSubscription, setCachedSubscription, clearCachedSubscription };
