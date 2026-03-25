const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const { getAuthUser } = require('../utils/auth');
const { resolveMaxProducts, fetchActiveProductCount } = require('../utils/productLimits');
const { getGlobalProductByBarcode, upsertGlobalProduct } = require('../services/globalBarcodeService');
const {
    ensureTenantProductCache,
    getProductByBarcodeFromCache,
    upsertProductInCache,
    removeProductFromCache,
    normalizeBarcode,
    hasBarcodeColumn
} = require('../services/tenantProductCache');

const getTenantId = (req) => req.tenant_id || req.tenant?.id || null;

// ✅ Get all products (search, filter, sort, pagination)
const getProducts = async (req, res) => {
    const {
        page,
        limit,
        search,
        category_id: categoryIdRaw,
        sort_by: sortByRaw,
        sort_order: sortOrderRaw
    } = req.query || {};

    const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
    const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const offset = (resolvedPage - 1) * resolvedLimit;

    const sortKey = (sortByRaw || 'created_at').toLowerCase();
    const sortOrder = (sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const allowedSorts = {
        name: 'name',
        selling_price: 'selling_price',
        stock_quantity: 'stock_quantity',
        created_at: 'created_at'
    };
    const resolvedSort = allowedSorts[sortKey] || 'created_at';

    const searchValue = typeof search === 'string' && search.trim() ? `%${search.trim()}%` : null;
    const categoryValue =
        typeof categoryIdRaw === 'string' && categoryIdRaw.trim() ? categoryIdRaw.trim() : null;

    try {
        const requestPool = getRequestPool(req);
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }

        const barcodeSelect = (await hasBarcodeColumn(requestPool))
            ? 'barcode'
            : 'NULL::text AS barcode';

        const productsRes = await requestPool.query(
            `SELECT id,
                    name,
                    company AS company_name,
                    category AS category_name,
                    selling_price,
                    actual_price,
                    stock_quantity,
                    expiry_date,
                    ${barcodeSelect},
                    NULL::int AS min_stock_level,
                    created_at
             FROM products
             WHERE is_deleted = FALSE
               AND ($1::text IS NULL OR category = $1)
               AND (
                 $2::text IS NULL
                 OR name ILIKE $2
                 OR company ILIKE $2
               )
             ORDER BY ${resolvedSort} ${sortOrder}, created_at DESC
             LIMIT $3 OFFSET $4`,
            [categoryValue, searchValue, resolvedLimit, offset]
        );

        const totalCountRes = await requestPool.query(
            `SELECT COUNT(*)::int AS total_records
             FROM products
             WHERE is_deleted = FALSE
               AND ($1::text IS NULL OR category = $1)
               AND (
                 $2::text IS NULL
                 OR name ILIKE $2
                 OR company ILIKE $2
               )`,
            [categoryValue, searchValue]
        );

        const totalRecords = Number(totalCountRes.rows[0]?.total_records || 0);
        const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / resolvedLimit);

        return res.json({
            products: productsRes.rows,
            pagination: {
                page: resolvedPage,
                limit: resolvedLimit,
                total_records: totalRecords,
                total_pages: totalPages
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
};

// ✅ Add new product
const addProduct = async (req, res) => {
  const {
    product_name: productNameInput,
    name: nameInput,
    category,
    selling_price,
    stock_quantity,
    company,
    actual_price,
    time_for_delivery,
    is_weight_based,
    expiry_date: expiryDateInput
  } = req.body;
  const expiry_date =
    Object.prototype.hasOwnProperty.call(req.body || {}, 'expiry_date') ||
    Object.prototype.hasOwnProperty.call(req.body || {}, 'expiryDate')
      ? expiryDateInput ?? req.body?.expiryDate ?? null
      : undefined;
  const normalizedExpiryDate = expiry_date === '' ? null : expiry_date;
  const product_name = productNameInput ?? nameInput;
  const barcodeProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'barcode');
  const barcode = normalizeBarcode(req.body?.barcode);

  try {
    if (!product_name) {
      return res.status(400).json({ message: 'Product name is required.' });
    }
    if (selling_price === undefined) {
      return res.status(400).json({ message: 'Selling price is required.' });
    }
    if (stock_quantity === undefined) {
      return res.status(400).json({ message: 'Stock quantity is required.' });
    }
    const requestPool = getRequestPool(req);
    const barcodeEnabled = req.features?.enable_barcode === true;
    if (barcodeEnabled && barcodeProvided && barcode) {
      const dupRes = await requestPool.query(
        'SELECT id FROM products WHERE barcode = $1 AND is_deleted = FALSE LIMIT 1',
        [barcode]
      );
      if (dupRes.rows.length > 0) {
        return res.status(400).json({ message: 'Barcode already exists.' });
      }
    }
    // 1. Check if product already exists with same name and company
    const existing = await requestPool.query(
      'SELECT * FROM products WHERE name = $1 AND company = $2',
      [product_name, company]
    );

    if (existing.rows.length > 0) {
      // 2. Product exists: update stock and prices
      const existingProduct = existing.rows[0];
      const resolvedBarcode =
        barcodeEnabled && barcodeProvided ? barcode : existingProduct.barcode ?? null;

      const updated = await requestPool.query(
        `UPDATE products
         SET stock_quantity = stock_quantity + $1,
             actual_price = $2,
             selling_price = $3,
             is_weight_based = $4,
             barcode = $5,
             expiry_date = $6
         WHERE id = $7
         RETURNING *`,
        [
          stock_quantity,
          actual_price,
          selling_price,
          is_weight_based ?? existingProduct.is_weight_based ?? 0,
          resolvedBarcode,
          normalizedExpiryDate === undefined ? existingProduct.expiry_date : normalizedExpiryDate,
          existingProduct.id
        ]
      );
      if (barcodeEnabled && barcodeProvided && resolvedBarcode) {
        try {
          await upsertGlobalProduct({
            barcode: resolvedBarcode,
            name: updated.rows[0]?.name,
            company: updated.rows[0]?.company,
            category: updated.rows[0]?.category
          });
        } catch (error) {
          console.error('Global barcode upsert failed:', error.message || error);
        }
      }

      const tenantId = getTenantId(req);
      if (tenantId) {
        upsertProductInCache(tenantId, updated.rows[0], {
          previousBarcode: existingProduct.barcode
        });
      }

      return res.status(200).json({
        message: 'Product already exists. Stock and prices updated.',
        product: updated.rows[0]
      });
    } else {
      const maxProducts = resolveMaxProducts(req.features);
      if (maxProducts !== null) {
        const totalProducts = await fetchActiveProductCount(requestPool);
        if (totalProducts >= maxProducts) {
          return res.status(403).json({
            message: `Product limit reached (${maxProducts}). Upgrade plan to add more products.`
          });
        }
      }
      // 3. Product doesn't exist: insert new
      const columns = [
        'name',
        'category',
        'selling_price',
        'stock_quantity',
        'actual_price',
        'company',
        'time_for_delivery',
        'is_weight_based'
      ];
      const values = [
        product_name,
        category,
        selling_price,
        stock_quantity,
        actual_price,
        company,
        time_for_delivery,
        is_weight_based ?? 0
      ];
      if (normalizedExpiryDate !== undefined) {
        columns.push('expiry_date');
        values.push(normalizedExpiryDate);
      }
      if (barcodeEnabled && barcodeProvided) {
        columns.push('barcode');
        values.push(barcode);
      }
      const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
      const result = await requestPool.query(
        `INSERT INTO products (${columns.join(', ')})
         VALUES (${placeholders})
         RETURNING *`,
        values
      );
      if (barcodeEnabled && barcodeProvided && barcode) {
        try {
          await upsertGlobalProduct({
            barcode,
            name: result.rows[0]?.name,
            company: result.rows[0]?.company,
            category: result.rows[0]?.category
          });
        } catch (error) {
          console.error('Global barcode upsert failed:', error.message || error);
        }
      }

      const tenantId = getTenantId(req);
      if (tenantId) {
        upsertProductInCache(tenantId, result.rows[0]);
      }

      return res.status(201).json({
        message: 'New product added.',
        product: result.rows[0]
      });
    }
  } catch (error) {
    console.error("Error adding/updating product:", error);
    res.status(500).json({ error: 'Database error' });
  }
};


// ✅ Update product
const updateProduct = async (req, res) => {
    const { id } = req.params;
    const {selling_price, actual_price, stock_quantity,name,company, is_weight_based, expiry_date: expiryDateInput } = req.body;
    const expiry_date =
        Object.prototype.hasOwnProperty.call(req.body || {}, 'expiry_date') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'expiryDate')
          ? expiryDateInput ?? req.body?.expiryDate ?? null
          : undefined;
    const normalizedExpiryDate = expiry_date === '' ? null : expiry_date;
    const barcodeProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'barcode');
    const barcode = normalizeBarcode(req.body?.barcode);
    try {
        const requestPool = getRequestPool(req);
        const barcodeEnabled = req.features?.enable_barcode === true;
        if (barcodeEnabled && barcodeProvided && barcode) {
            const dupRes = await requestPool.query(
                'SELECT id FROM products WHERE barcode = $1 AND id <> $2 AND is_deleted = FALSE LIMIT 1',
                [barcode, id]
            );
            if (dupRes.rows.length > 0) {
                return res.status(400).json({ message: 'Barcode already exists.' });
            }
        }
        const productRes = await requestPool.query('select * from products where id = $1', [id]);
        const product = productRes.rows[0];
        // console.log(product)
        // const result = await pool.query(
        //     'UPDATE products SET name = $1, category = $2, selling_price = $3, stock_quantity = $4, actual_price = $5, company = $6 WHERE id = $7 RETURNING *',
        //     [product_name|| product.name, category || product.category, selling_price || product.selling_price, stock_quantity || product.stock_quantity,actual_price || product.actual_price, company || product.company, id]
        // );
        const updateFields = [
            'name = $1',
            'company = $2',
            'selling_price = $3',
            'actual_price = $4',
            'stock_quantity = $5',
            'is_weight_based = $6'
        ];
        const updateValues = [
            name || product.name,
            company || product.company,
            selling_price ?? product.selling_price,
            actual_price ?? product.actual_price,
            stock_quantity ?? product.stock_quantity,
            is_weight_based ?? product.is_weight_based ?? 0
        ];
        if (normalizedExpiryDate !== undefined) {
            updateFields.push(`expiry_date = $${updateValues.length + 1}`);
            updateValues.push(normalizedExpiryDate);
        }
        if (barcodeEnabled && barcodeProvided) {
            updateFields.push(`barcode = $${updateValues.length + 1}`);
            updateValues.push(barcode);
        }
        updateValues.push(id);
        const result = await requestPool.query(
            `UPDATE products SET ${updateFields.join(', ')} WHERE id = $${updateValues.length} RETURNING *`,
            updateValues
        );
        if (barcodeEnabled && barcodeProvided && barcode) {
            try {
                await upsertGlobalProduct({
                    barcode,
                    name: result.rows[0]?.name,
                    company: result.rows[0]?.company,
                    category: result.rows[0]?.category
                });
            } catch (error) {
                console.error('Global barcode upsert failed:', error.message || error);
            }
        }
        const tenantId = getTenantId(req);
        if (tenantId) {
            upsertProductInCache(tenantId, result.rows[0], {
                previousBarcode: product?.barcode
            });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error, message: 'Database error' });
    }
};

// ✅ Soft delete product
const deleteProduct = async (req, res) => {
    const { id } = req.params;
    try {
        const requestPool = getRequestPool(req);
        const existingRes = await requestPool.query(
            'SELECT id, barcode FROM products WHERE id = $1',
            [id]
        );
        await requestPool.query('UPDATE products SET is_deleted = true WHERE id = $1', [id]);
        const tenantId = getTenantId(req);
        if (tenantId && existingRes.rowCount > 0) {
            removeProductFromCache(tenantId, existingRes.rows[0]);
        }
        res.json({ message: 'Product deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
};

const searchProductsForSale = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const view = String(req.query?.view || '').toLowerCase();
        const { name, barcode, q } = req.query;
        const term = (q || name || barcode || '').toString().trim();
        if (!term) {
            return res.status(400).json({ error: "Product name is required for search." });
        }
        const barcodeEnabled = req.features?.enable_barcode === true;
        const barcodeSupported = barcodeEnabled && (await hasBarcodeColumn(requestPool));
        const barcodeValue = barcodeSupported ? normalizeBarcode(q || barcode) : null;

        if (view === 'mobile') {
            const barcodeSelect = barcodeSupported ? 'barcode' : 'NULL::text AS barcode';
            const query = `
                SELECT
                    id,
                    name,
                    ${barcodeSelect},
                    selling_price AS price,
                    stock_quantity AS stock
                FROM products
                WHERE is_deleted = FALSE
                  AND (
                    name ILIKE $1
                    OR company ILIKE $1
                    ${barcodeSupported ? 'OR ($2::text IS NOT NULL AND barcode = $2)' : ''}
                  )
                ORDER BY name ASC
                LIMIT 20
            `;
            const values = barcodeSupported ? [`%${term}%`, barcodeValue] : [`%${term}%`];
            const { rows } = await requestPool.query(query, values);
            return res.status(200).json({ products: rows });
        }

        const query = `
            SELECT
                id,
                name,
                company,
                selling_price,
                stock_quantity,
                is_weight_based
            FROM products
            WHERE is_deleted = FALSE
              AND (
                name ILIKE $1
                OR company ILIKE $1
                ${barcodeSupported ? 'OR ($2::text IS NOT NULL AND barcode = $2)' : ''}
              )
            ORDER BY name ASC
            LIMIT 20
        `;
        const values = barcodeSupported ? [`%${term}%`, barcodeValue] : [`%${term}%`];
        const { rows } = await requestPool.query(query, values);
        return res.status(200).json({ products: rows });
    } catch (error) {
        console.error("Error searching products:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
 }

const searchProductsForPurchase = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const { name, barcode } = req.query;
        const term = (name || barcode || '').toString().trim();
        if (!term) {
            return res.status(400).json({ error: "Product name is required for search." });
        }
        const barcodeEnabled = req.features?.enable_barcode === true;
        const barcodeSupported = barcodeEnabled && (await hasBarcodeColumn(requestPool));
        const barcodeValue = barcodeSupported ? normalizeBarcode(barcode) : null;

        const query = `
            SELECT
                id,
                name,
                selling_price,
                actual_price,
                company,
                stock_quantity,
                is_weight_based,
                time_for_delivery,
                category
            FROM products
            WHERE is_deleted = FALSE
              AND (
                name ILIKE $1
                OR company ILIKE $1
                ${barcodeSupported ? 'OR ($2::text IS NOT NULL AND barcode = $2)' : ''}
              )
            ORDER BY name ASC
            LIMIT 20
        `;
        const values = barcodeSupported ? [`%${term}%`, barcodeValue] : [`%${term}%`];
        const { rows } = await requestPool.query(query, values);
        return res.status(200).json({ products: rows });
    } catch (error) {
        console.error("Error searching products for purchase:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}

const getProductByBarcodeForSale = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        if (req.features?.enable_barcode !== true) {
            return res.status(403).json({ error: "Barcode feature is disabled." });
        }
        if (!(await hasBarcodeColumn(requestPool))) {
            return res.status(503).json({ error: "Barcode is not supported on this tenant yet." });
        }
        const code = normalizeBarcode(req.params.barcode || req.params.code || req.query.barcode || req.query.code);
        if (!code) {
            return res.status(400).json({ error: "Barcode is required." });
        }

        const tenantId = getTenantId(req);
        if (tenantId) {
            const start = Date.now();
            await ensureTenantProductCache(tenantId, requestPool);
            const cached = getProductByBarcodeFromCache(tenantId, code);
            if (cached) {
                console.log(`[Cache HIT] barcode lookup ${Date.now() - start}ms`);
                const product = {
                    id: cached.id,
                    name: cached.name,
                    company: cached.company,
                    category: cached.category,
                    selling_price: cached.selling_price,
                    stock_quantity: cached.stock_quantity,
                    is_weight_based: cached.is_weight_based,
                    barcode: cached.barcode
                };
                return res.status(200).json({ product });
            }
            console.log(`[Cache MISS] barcode lookup ${Date.now() - start}ms`);
        } else {
            const result = await requestPool.query(
                `SELECT id,
                        name,
                        company,
                        category,
                        selling_price,
                        stock_quantity,
                        is_weight_based,
                        barcode
                 FROM products
                 WHERE barcode = $1
                   AND is_deleted = FALSE
                 LIMIT 1`,
                [code]
            );
            const product = result.rows[0] || null;
            if (product) {
                return res.status(200).json({ product });
            }
        }
        const globalMatch = await getGlobalProductByBarcode(code);
        if (!globalMatch) {
            return res.status(404).json({ error: "Product not found." });
        }
        return res.status(200).json({
            product: null,
            lookup: globalMatch,
            source: 'global'
        });
    } catch (error) {
        console.error("Error searching product by barcode:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

// ✅ Full product cache for IndexedDB sync
const getProductsCacheDB = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const tenantId = getTenantId(req);

        if (tenantId) {
            const cache = await ensureTenantProductCache(tenantId, requestPool);
            if (cache) {
                  const products = Array.from(cache.productsById.values()).map((product) => ({
                      id: product.id,
                      name: product.name,
                      company: product.company,
                      barcode: product.barcode,
                      selling_price: product.selling_price,
                      stock_quantity: product.stock_quantity,
                      is_weight_based: product.is_weight_based,
                      expiry_date: product.expiry_date ?? null
                  }));
                return res.status(200).json({ products });
            }
        }

        const barcodeSelect = (await hasBarcodeColumn(requestPool))
            ? 'barcode'
            : 'NULL::text AS barcode';
        const result = await requestPool.query(
            `SELECT id,
                    name,
                      company,
                      ${barcodeSelect},
                      selling_price,
                      stock_quantity,
                      is_weight_based,
                      expiry_date
               FROM products
               WHERE is_deleted = FALSE`
          );
        return res.status(200).json({ products: result.rows });
    } catch (error) {
        console.error('Error fetching cacheDB products:', error);
        return res.status(500).json({ error: 'Database error' });
    }
};

// ✅ Lightweight cache endpoint for fast billing lookups
const getProductsCache = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const rawBarcode = req.query?.barcode;
        const rawSearch = req.query?.search;
        const barcode = typeof rawBarcode === 'string' ? rawBarcode.trim() : '';
        const search = typeof rawSearch === 'string' ? rawSearch.trim() : '';

        if (barcode) {
            const result = await requestPool.query(
                `SELECT id,
                        name,
                          barcode,
                          selling_price,
                          actual_price,
                          stock_quantity,
                          is_weight_based,
                          expiry_date
                   FROM products
                   WHERE barcode = $1
                     AND is_deleted = FALSE
                 LIMIT 1`,
                [barcode]
            );
            return res.status(200).json({ products: result.rows });
        }

        if (search) {
            const result = await requestPool.query(
                `SELECT id,
                        name,
                          barcode,
                          selling_price,
                          actual_price,
                          stock_quantity,
                          is_weight_based,
                          expiry_date
                   FROM products
                   WHERE name ILIKE $1
                   AND is_deleted = FALSE
                 LIMIT 20`,
                [`%${search}%`]
            );
            return res.status(200).json({ products: result.rows });
        }

        return res.status(400).json({ message: 'barcode or search is required.' });
    } catch (error) {
        console.error('Error fetching product cache:', error);
        return res.status(500).json({ error: 'Database error' });
    }
};

const getProductByBarcodeForPurchase = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        if (req.features?.enable_barcode !== true) {
            return res.status(403).json({ error: "Barcode feature is disabled." });
        }
        if (!(await hasBarcodeColumn(requestPool))) {
            return res.status(503).json({ error: "Barcode is not supported on this tenant yet." });
        }
        const code = normalizeBarcode(req.params.barcode || req.params.code || req.query.barcode || req.query.code);
        if (!code) {
            return res.status(400).json({ error: "Barcode is required." });
        }

        const tenantId = getTenantId(req);
        if (tenantId) {
            const start = Date.now();
            await ensureTenantProductCache(tenantId, requestPool);
            const cached = getProductByBarcodeFromCache(tenantId, code);
            if (cached) {
                console.log(`[Cache HIT] barcode lookup ${Date.now() - start}ms`);
                const product = {
                    id: cached.id,
                    name: cached.name,
                    selling_price: cached.selling_price,
                    actual_price: cached.actual_price,
                    company: cached.company,
                    stock_quantity: cached.stock_quantity,
                    type: cached.is_weight_based,
                    is_weight_based: cached.is_weight_based,
                    time_for_delivery: cached.time_for_delivery,
                    category: cached.category,
                    barcode: cached.barcode
                };
                return res.status(200).json({ product });
            }
            console.log(`[Cache MISS] barcode lookup ${Date.now() - start}ms`);
        } else {
            const result = await requestPool.query(
                `SELECT
                    id,
                    name,
                    selling_price,
                    actual_price,
                    company,
                    stock_quantity,
                    is_weight_based AS type,
                    is_weight_based,
                    time_for_delivery,
                    category,
                    barcode
                 FROM products
                 WHERE barcode = $1
                   AND is_deleted = FALSE
                 LIMIT 1`,
                [code]
            );
            const product = result.rows[0] || null;
            if (product) {
                return res.status(200).json({ product });
            }
        }
        const globalMatch = await getGlobalProductByBarcode(code);
        if (!globalMatch) {
            return res.status(404).json({ error: "Product not found." });
        }
        return res.status(200).json({
            product: null,
            lookup: globalMatch,
            source: 'global'
        });
    } catch (error) {
        console.error("Error searching product by barcode for purchase:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

const getProductById = async (req, res) => {
    const rawId = req.params?.id;
    const id = Number(rawId);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ message: 'Valid product id is required.' });
    }

    try {
        const requestPool = getRequestPool(req);
        const barcodeSelect = (await hasBarcodeColumn(requestPool))
            ? 'barcode'
            : 'NULL::text AS barcode';

        const result = await requestPool.query(
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
             WHERE id = $1
               AND is_deleted = FALSE
             LIMIT 1`,
            [id]
        );

        const product = result.rows[0] || null;
        if (!product) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        return res.status(200).json({ product });
    } catch (error) {
        console.error('Error fetching product by id:', error);
        return res.status(500).json({ error: 'Database error' });
    }
};

module.exports = {
    getProducts,
    addProduct,
    updateProduct,
    deleteProduct,
    getProductById,
    searchProductsForSale,
    searchProductsForPurchase,
    getProductByBarcodeForSale,
    getProductByBarcodeForPurchase,
    getProductsCache,
    getProductsCacheDB,
    getProductsExtraDetails
};

// ✅ Extra product details for IndexedDB sync/lookup
async function getProductsExtraDetails(req, res) {
    try {
        const requestPool = getRequestPool(req);
        const barcodeSupported = await hasBarcodeColumn(requestPool);

        const rawBarcode = req.query?.barcode;
        const rawBarcodes = req.query?.barcodes;
        const rawId = req.query?.id;
        const rawIds = req.query?.ids;

        const singleBarcode = normalizeBarcode(rawBarcode);
        const barcodeList = typeof rawBarcodes === 'string'
            ? rawBarcodes.split(',').map((b) => normalizeBarcode(b)).filter(Boolean)
            : [];

        const singleId = rawId ? Number(rawId) : null;
        const idList = typeof rawIds === 'string'
            ? rawIds.split(',').map((id) => Number(id)).filter((id) => Number.isFinite(id))
            : [];

        const barcodes = [];
        if (singleBarcode) barcodes.push(singleBarcode);
        if (barcodeList.length > 0) barcodes.push(...barcodeList);

        const ids = [];
        if (Number.isFinite(singleId)) ids.push(singleId);
        if (idList.length > 0) ids.push(...idList);

        if (barcodes.length === 0 && ids.length === 0) {
            return res.status(400).json({ message: 'barcode(s) or id(s) are required.' });
        }

        if (barcodes.length > 0 && !barcodeSupported) {
            return res.status(503).json({ error: 'Barcode is not supported on this tenant yet.' });
        }

        const barcodeSelect = barcodeSupported ? 'barcode' : 'NULL::text AS barcode';
        const conditions = [];
        const values = [];

        if (barcodes.length > 0) {
            values.push(barcodes);
            conditions.push(`${barcodeSelect === 'barcode' ? 'barcode' : 'NULL'} = ANY($${values.length}::text[])`);
        }
        if (ids.length > 0) {
            values.push(ids);
            conditions.push(`id = ANY($${values.length}::int[])`);
        }

        const whereClause = conditions.length > 0 ? `AND (${conditions.join(' OR ')})` : '';

          const result = await requestPool.query(
              `SELECT ${barcodeSelect} AS barcode,
                      actual_price,
                      category,
                      company,
                      expiry_date
               FROM products
               WHERE is_deleted = FALSE
               ${whereClause}`,
            values
        );

        return res.status(200).json({ products: result.rows });
    } catch (error) {
        console.error('Error fetching extra product details:', error);
        return res.status(500).json({ error: 'Database error' });
    }
}
