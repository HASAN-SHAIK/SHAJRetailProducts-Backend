const { jsonError, jsonOk } = require('../../utils/responses');
const { resolveMaxProducts, fetchActiveProductCount } = require('../../utils/productLimits');
const { upsertProductInCache } = require('../../services/tenantProductCache');

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
      `SELECT id, name, company, category, selling_price, stock_quantity, is_weight_based
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
      actual_price,
      is_weight_based,
      time_for_delivery
    } = req.body;

    if (!name || !selling_price || stock_quantity === undefined) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required fields');
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
      `INSERT INTO products (name, company, category, selling_price, stock_quantity, actual_price, is_weight_based, time_for_delivery)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, company, category, selling_price, stock_quantity, is_weight_based, time_for_delivery`,
      [
        name,
        company || null,
        category || null,
        selling_price,
        stock_quantity,
        actual_price || null,
        !!is_weight_based,
        time_for_delivery ?? null
      ]
    );

    if (req.tenant_id) {
      upsertProductInCache(req.tenant_id, insertRes.rows[0]);
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
