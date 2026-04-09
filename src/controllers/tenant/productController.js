const { jsonError, jsonOk } = require('../../utils/responses');
const { resolveMaxProducts, fetchActiveProductCount } = require('../../utils/productLimits');
const { upsertProductInCache } = require('../../services/tenantProductCache');
const { invalidateProductCaches } = require('../../services/smartCache');

const normalizeDateOnly = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const isExpiryBeforeBatchDate = (expiryValue, batchDate = new Date()) => {
  const expiryDate = normalizeDateOnly(expiryValue);
  if (!expiryDate) return false;
  const batchDateOnly = normalizeDateOnly(batchDate);
  return Boolean(batchDateOnly && expiryDate < batchDateOnly);
};

const allowedSorts = new Set([
  'id',
  'name',
  'company',
  'category',
  'selling_price',
  'stock_quantity',
  'created_at'
]);

const getProducts = async (req, res) => {
  try {
    const { tenantPool } = req;
    let { sort } = req.query;
    if (typeof sort !== 'string') sort = 'name';
    const normalized = sort.trim().toLowerCase();
    sort = allowedSorts.has(normalized) ? normalized : 'name';

    const result = await tenantPool.query(
      `SELECT id, name, company, category, selling_price, stock_quantity, is_weight_based, expiry_date
       FROM products
       WHERE is_deleted = FALSE
       ORDER BY ${sort}`
    );

    return jsonOk(res, result.rows);
  } catch (error) {
    return jsonError(res, 500, 'PRODUCTS_FETCH_FAILED', error.message);
  }
};

const createProduct = async (req, res) => {
  try {
    const { tenantPool } = req;
    const {
      name,
      company,
      category,
      selling_price,
      stock_quantity,
      purchase_price,
      is_weight_based,
      time_for_delivery,
      expiry_date
    } = req.body;
    const normalizedExpiryDate = expiry_date === '' ? null : expiry_date;

    if (!name || !selling_price || stock_quantity === undefined) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required fields');
    }
    if (expiry_date !== undefined) {
      const normalizedExpiry = normalizeDateOnly(expiry_date);
      if (expiry_date !== null && expiry_date !== '' && normalizedExpiry === undefined) {
        return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid expiry_date');
      }
      if (normalizedExpiry && isExpiryBeforeBatchDate(normalizedExpiry)) {
        return jsonError(res, 400, 'VALIDATION_ERROR', 'Expiry date must be on or after batch date.');
      }
    }
    const maxProducts = resolveMaxProducts(req.features);
    if (maxProducts !== null) {
      const totalProducts = await fetchActiveProductCount(tenantPool);
      if (totalProducts >= maxProducts) {
        return jsonError(
          res,
          403,
          'PRODUCT_LIMIT_REACHED',
          `Product limit reached (${maxProducts}). Upgrade plan to add more products.`
        );
      }
    }

    const insertRes = await tenantPool.query(
      `INSERT INTO products (name, company, category, selling_price, stock_quantity, purchase_price, is_weight_based, time_for_delivery, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, company, category, selling_price, stock_quantity, is_weight_based, time_for_delivery, expiry_date`,
      [
        name,
        company || null,
        category || null,
        selling_price,
        stock_quantity,
        purchase_price || null,
        !!is_weight_based,
        time_for_delivery ?? null,
        normalizedExpiryDate ?? null
      ]
    );

    if (req.tenant_id) {
      upsertProductInCache(req.tenant_id, insertRes.rows[0]);
      invalidateProductCaches(req.tenant_id, null, insertRes.rows[0]);
    }

    return jsonOk(res, insertRes.rows[0], 'Product created');
  } catch (error) {
    return jsonError(res, 500, 'PRODUCT_CREATE_FAILED', error.message);
  }
};

const getProductByBarcode = async (req, res) => {
  return jsonError(res, 400, 'FEATURE_DISABLED', 'Barcode lookup is not supported in the current schema');
};

module.exports = { getProducts, createProduct, getProductByBarcode };

