const DEFAULTS = {
  productTtlMs: 15 * 60 * 1000,
  searchTtlMs: 5 * 60 * 1000,
  dashboardTtlMs: 3 * 60 * 1000,
  recentOrdersTtlMs: 2 * 60 * 1000,
  maxEntries: Number(process.env.SMART_CACHE_MAX_ENTRIES || 5000),
  maxEntriesPerTenant: Number(process.env.SMART_CACHE_MAX_PER_TENANT || 1000),
  warnThreshold: 0.9
};

const globalCache = new Map();
const tenantIndex = new Map();
let lastWarnAt = 0;

const normalizeSegment = (value, fallback = 'all') => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
};

const buildProductIdKey = (tenantId, productId) =>
  `tenant:${tenantId}:product:${productId}`;

const buildBarcodeKey = (tenantId, branchId, barcode) =>
  `tenant:${tenantId}:branch:${normalizeSegment(branchId)}:barcode:${barcode}`;

const buildSearchKey = (tenantId, branchId, query) =>
  `tenant:${tenantId}:branch:${normalizeSegment(branchId)}:search:${String(query || '')
    .trim()
    .toLowerCase()}`;

const buildDashboardKey = (tenantId, branchId) =>
  `tenant:${tenantId}:branch:${normalizeSegment(branchId)}:dashboard:today`;

const buildRecentOrdersKey = (tenantId, branchId) =>
  `tenant:${tenantId}:branch:${normalizeSegment(branchId)}:orders:recent`;

const logEvent = (type, key, meta) => {
  if (process.env.SMART_CACHE_DEBUG !== 'true') return;
  const suffix = meta ? ` ${meta}` : '';
  console.log(`[Cache ${type}] ${key}${suffix}`);
};

const touchKey = (key, entry) => {
  globalCache.delete(key);
  globalCache.set(key, entry);
  if (entry.tenantId) {
    let tenantMap = tenantIndex.get(entry.tenantId);
    if (!tenantMap) {
      tenantMap = new Map();
      tenantIndex.set(entry.tenantId, tenantMap);
    }
    tenantMap.delete(key);
    tenantMap.set(key, true);
  }
};

const evictKey = (key, reason = 'evict') => {
  const entry = globalCache.get(key);
  if (!entry) return;
  globalCache.delete(key);
  if (entry.tenantId) {
    const tenantMap = tenantIndex.get(entry.tenantId);
    if (tenantMap) {
      tenantMap.delete(key);
      if (tenantMap.size === 0) tenantIndex.delete(entry.tenantId);
    }
  }
  logEvent(reason.toUpperCase(), key);
};

const ensureLimits = (tenantId) => {
  while (globalCache.size > DEFAULTS.maxEntries) {
    const oldestKey = globalCache.keys().next().value;
    if (!oldestKey) break;
    evictKey(oldestKey, 'lru');
  }

  if (tenantId) {
    const tenantMap = tenantIndex.get(tenantId);
    while (tenantMap && tenantMap.size > DEFAULTS.maxEntriesPerTenant) {
      const oldestKey = tenantMap.keys().next().value;
      if (!oldestKey) break;
      evictKey(oldestKey, 'tenant-lru');
    }
  }

  const now = Date.now();
  if (now - lastWarnAt > 60 * 1000) {
    const globalThreshold = DEFAULTS.maxEntries * DEFAULTS.warnThreshold;
    if (globalCache.size >= globalThreshold) {
      console.warn(
        `[Cache WARN] global entries ${globalCache.size}/${DEFAULTS.maxEntries}`
      );
      lastWarnAt = now;
    }
    if (tenantId) {
      const tenantMap = tenantIndex.get(tenantId);
      if (tenantMap && tenantMap.size >= DEFAULTS.maxEntriesPerTenant * DEFAULTS.warnThreshold) {
        console.warn(
          `[Cache WARN] tenant ${tenantId} entries ${tenantMap.size}/${DEFAULTS.maxEntriesPerTenant}`
        );
        lastWarnAt = now;
      }
    }
  }
};

const cacheGet = (key) => {
  const entry = globalCache.get(key);
  if (!entry) {
    logEvent('MISS', key);
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    evictKey(key, 'expired');
    logEvent('MISS', key);
    return null;
  }
  touchKey(key, entry);
  logEvent('HIT', key);
  return entry.value;
};

const cacheSet = (key, value, ttlMs, options = {}) => {
  if (!key || ttlMs <= 0) return;
  const entry = {
    value,
    expiresAt: Date.now() + ttlMs,
    tenantId: options.tenantId || null
  };
  globalCache.set(key, entry);
  touchKey(key, entry);
  logEvent(options.refresh ? 'REFRESH' : 'SET', key);
  ensureLimits(options.tenantId || null);
};

const cacheDel = (key) => {
  if (!key) return;
  evictKey(key, 'invalidate');
};

const cacheDelByPrefix = (prefix) => {
  if (!prefix) return 0;
  let removed = 0;
  for (const key of Array.from(globalCache.keys())) {
    if (key.startsWith(prefix)) {
      evictKey(key, 'invalidate');
      removed += 1;
    }
  }
  if (removed > 0) {
    console.log(`[Cache INVALIDATE] prefix ${prefix} removed ${removed}`);
  }
  return removed;
};

const invalidateDashboardCache = (tenantId, branchId) => {
  cacheDel(buildDashboardKey(tenantId, branchId));
};

const invalidateRecentOrdersCache = (tenantId, branchId) => {
  cacheDel(buildRecentOrdersKey(tenantId, branchId));
};

const invalidateSearchCache = (tenantId, branchId) => {
  cacheDelByPrefix(`tenant:${tenantId}:branch:${normalizeSegment(branchId)}:search:`);
};

const invalidateProductCaches = (tenantId, branchId, product) => {
  if (!tenantId) return;
  if (product?.id != null) {
    cacheDel(buildProductIdKey(tenantId, product.id));
  }
  if (product?.barcode) {
    cacheDel(buildBarcodeKey(tenantId, branchId, product.barcode));
  }
  invalidateSearchCache(tenantId, branchId);
  invalidateDashboardCache(tenantId, branchId);
  invalidateRecentOrdersCache(tenantId, branchId);
};

const invalidateOrderCaches = (tenantId, branchId) => {
  if (!tenantId) return;
  invalidateDashboardCache(tenantId, branchId);
  invalidateRecentOrdersCache(tenantId, branchId);
  console.log(`[Cache INVALIDATE] reports summary tenant:${tenantId} branch:${normalizeSegment(branchId)}`);
  console.log(`[Cache INVALIDATE] customer balance tenant:${tenantId} branch:${normalizeSegment(branchId)}`);
};

module.exports = {
  DEFAULTS,
  buildProductIdKey,
  buildBarcodeKey,
  buildSearchKey,
  buildDashboardKey,
  buildRecentOrdersKey,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelByPrefix,
  invalidateDashboardCache,
  invalidateRecentOrdersCache,
  invalidateSearchCache,
  invalidateProductCaches,
  invalidateOrderCaches
};
