const barcodeColumnCache = new WeakMap();
const {
  cacheGet,
  cacheSet,
  cacheDel,
  buildProductIdKey,
  buildBarcodeKey,
  DEFAULTS
} = require('./smartCache');

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

const ensureTenantProductCache = async (tenantId, tenantPool) => {
  if (!tenantId || !tenantPool) return null;
  const barcodeSupported = await hasBarcodeColumn(tenantPool);
  return { barcodeSupported };
};

const getProductByBarcodeFromCache = (tenantId, barcode, branchId = null) => {
  if (!tenantId) return null;
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return null;
  return cacheGet(buildBarcodeKey(tenantId, branchId, normalized)) || null;
};

const getProductByIdFromCache = (tenantId, id) => {
  if (!tenantId) return null;
  return cacheGet(buildProductIdKey(tenantId, id)) || null;
};

const upsertProductInCache = (tenantId, product, options = {}) => {
  if (!tenantId || !product || product.id === undefined || product.id === null) return;
  const cached = {
    id: product.id,
    name: product.name,
    company: product.company ?? null,
    category: product.category ?? null,
    selling_price: product.selling_price,
    purchase_price: product.purchase_price ?? null,
    mrp: product.mrp ?? null,
    hsn_code: product.hsn_code ?? null,
    gst_percentage: product.gst_percentage ?? null,
    is_batch_enabled: product.is_batch_enabled ?? null,
    stock_quantity: product.stock_quantity,
    is_weight_based: product.is_weight_based,
    time_for_delivery: product.time_for_delivery ?? null,
    expiry_date: product.expiry_date ?? null,
    created_at: product.created_at ?? null,
    branch_id: product.branch_id ?? null,
    barcode: product.barcode ?? null
  };

  cacheSet(buildProductIdKey(tenantId, cached.id), cached, DEFAULTS.productTtlMs, {
    tenantId,
    refresh: true
  });

  const normalized = normalizeBarcode(cached.barcode);
  const normalizedPrev = normalizeBarcode(options.previousBarcode);
  if (normalizedPrev && normalizedPrev !== normalized) {
    cacheDel(buildBarcodeKey(tenantId, cached.branch_id ?? null, normalizedPrev));
  }
  if (normalized) {
    cacheSet(buildBarcodeKey(tenantId, cached.branch_id ?? null, normalized), cached, DEFAULTS.productTtlMs, {
      tenantId,
      refresh: true
    });
  }
};

const removeProductFromCache = (tenantId, product) => {
  if (!tenantId || !product) return;
  if (product.id !== undefined && product.id !== null) {
    cacheDel(buildProductIdKey(tenantId, product.id));
  }
  const normalized = normalizeBarcode(product.barcode);
  if (normalized) {
    cacheDel(buildBarcodeKey(tenantId, product.branch_id ?? null, normalized));
  }
};

const invalidateTenantCache = () => {};

module.exports = {
  ensureTenantProductCache,
  getProductByBarcodeFromCache,
  getProductByIdFromCache,
  upsertProductInCache,
  removeProductFromCache,
  invalidateTenantCache,
  normalizeBarcode,
  hasBarcodeColumn
};
