const barcodeColumnCache = new WeakMap();
const tenantCaches = new Map();

let cleanupTimer = null;

const getIdleSettings = () => {
  const ttlMs = Number(process.env.TENANT_CACHE_IDLE_EVICT_MS || 45 * 60 * 1000);
  const sweepMs = Number(process.env.TENANT_CACHE_IDLE_SWEEP_MS || 10 * 60 * 1000);
  return { ttlMs, sweepMs };
};

const normalizeBarcode = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.toString().trim();
  return trimmed ? trimmed : null;
};

const hasBarcodeColumn = async (requestPool) => {
  if (barcodeColumnCache.has(requestPool)) {
    return barcodeColumnCache.get(requestPool);
  }
  const res = await requestPool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = 'barcode'
     LIMIT 1`
  );
  const supported = res.rowCount > 0;
  barcodeColumnCache.set(requestPool, supported);
  return supported;
};

const touch = (tenantId) => {
  const entry = tenantCaches.get(tenantId);
  if (entry) {
    entry.lastUsed = Date.now();
  }
};

const getTenantCache = (tenantId) => {
  const entry = tenantCaches.get(tenantId);
  if (entry) touch(tenantId);
  return entry || null;
};

const loadProductsToCache = async (tenantId, tenantPool) => {
  if (!tenantId || !tenantPool) return null;
  const start = Date.now();
  const barcodeSupported = await hasBarcodeColumn(tenantPool);
  const barcodeSelect = barcodeSupported ? 'barcode' : 'NULL::text AS barcode';

  const result = await tenantPool.query(
    `SELECT id,
            name,
            company,
            category,
            selling_price,
            actual_price,
            stock_quantity,
            is_weight_based,
            time_for_delivery,
            expiry_date,
            ${barcodeSelect}
     FROM products
     WHERE is_deleted = FALSE`
  );

  const productsByBarcode = new Map();
  const productsById = new Map();

  for (const row of result.rows) {
    const product = {
      id: row.id,
      name: row.name,
      company: row.company ?? null,
      category: row.category ?? null,
      selling_price: row.selling_price,
      actual_price: row.actual_price ?? null,
      stock_quantity: row.stock_quantity,
      is_weight_based: row.is_weight_based,
      time_for_delivery: row.time_for_delivery ?? null,
      expiry_date: row.expiry_date ?? null,
      barcode: row.barcode ?? null
    };

    productsById.set(product.id, product);
    const normalized = normalizeBarcode(product.barcode);
    if (barcodeSupported && normalized) {
      productsByBarcode.set(normalized, product);
    }
  }

  const cache = {
    productsByBarcode,
    productsById,
    lastLoadedAt: Date.now(),
    lastUsed: Date.now(),
    barcodeSupported
  };

  tenantCaches.set(tenantId, cache);
  startCleanup();

  const durationMs = Date.now() - start;
  console.log(
    `[Cache LOAD] tenant ${tenantId} loaded ${result.rowCount} products in ${durationMs}ms`
  );

  return cache;
};

const ensureTenantProductCache = async (tenantId, tenantPool) => {
  const existing = getTenantCache(tenantId);
  if (existing) return existing;
  return loadProductsToCache(tenantId, tenantPool);
};

const getProductByBarcodeFromCache = (tenantId, barcode) => {
  const entry = getTenantCache(tenantId);
  if (!entry) return null;
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return null;
  return entry.productsByBarcode.get(normalized) || null;
};

const getProductByIdFromCache = (tenantId, id) => {
  const entry = getTenantCache(tenantId);
  if (!entry) return null;
  return entry.productsById.get(id) || null;
};

const upsertProductInCache = (tenantId, product, options = {}) => {
  const entry = getTenantCache(tenantId);
  if (!entry || !product || product.id === undefined || product.id === null) return;

  const normalized = normalizeBarcode(product.barcode);
  const normalizedPrev = normalizeBarcode(options.previousBarcode);
  if (normalizedPrev && normalizedPrev !== normalized) {
    entry.productsByBarcode.delete(normalizedPrev);
  }

  const cached = {
    id: product.id,
    name: product.name,
    company: product.company ?? null,
    category: product.category ?? null,
    selling_price: product.selling_price,
    actual_price: product.actual_price ?? null,
    stock_quantity: product.stock_quantity,
    is_weight_based: product.is_weight_based,
    time_for_delivery: product.time_for_delivery ?? null,
    expiry_date: product.expiry_date ?? null,
    barcode: product.barcode ?? null
  };

  entry.productsById.set(cached.id, cached);
  if (entry.barcodeSupported && normalized) {
    entry.productsByBarcode.set(normalized, cached);
  }
};

const removeProductFromCache = (tenantId, product) => {
  const entry = getTenantCache(tenantId);
  if (!entry || !product) return;
  if (product.id !== undefined && product.id !== null) {
    entry.productsById.delete(product.id);
  }
  const normalized = normalizeBarcode(product.barcode);
  if (normalized) {
    entry.productsByBarcode.delete(normalized);
  }
};

const invalidateTenantCache = (tenantId) => {
  tenantCaches.delete(tenantId);
};

const closeIdleTenantCaches = () => {
  const now = Date.now();
  const { ttlMs } = getIdleSettings();
  for (const [tenantId, entry] of tenantCaches.entries()) {
    if (now - entry.lastUsed > ttlMs) {
      tenantCaches.delete(tenantId);
      console.log(`[Cache CLEANUP] evicted tenant ${tenantId} product cache`);
    }
  }
};

const startCleanup = () => {
  if (cleanupTimer) return;
  const { sweepMs } = getIdleSettings();
  cleanupTimer = setInterval(() => {
    closeIdleTenantCaches();
  }, Math.max(30_000, sweepMs));
  cleanupTimer.unref?.();
};

module.exports = {
  ensureTenantProductCache,
  loadProductsToCache,
  getTenantCache,
  getProductByBarcodeFromCache,
  getProductByIdFromCache,
  upsertProductInCache,
  removeProductFromCache,
  invalidateTenantCache,
  normalizeBarcode,
  hasBarcodeColumn
};
