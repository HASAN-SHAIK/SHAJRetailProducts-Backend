const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const { getAuthUser } = require('../utils/auth');
const { resolveMaxProducts, fetchActiveProductCount } = require('../utils/productLimits');
const { getGlobalProductByBarcode, upsertGlobalProduct } = require('../services/globalBarcodeService');
const { jsonOk } = require('../utils/responses');
const { resolveGstPercentage, upsertHsnGst } = require('../services/hsnGst.service');

const attachGst = (product) => {
    if (!product) return product;
    return { ...product, gst_percentage: product.gst_percentage ?? null };
};

const attachGstList = (products) => Array.isArray(products) ? products.map(attachGst) : products;
const normalizeProductTypeFlag = (value, fallback = false) => {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'weight', 'weighted', 'weight based', 'weight-based'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'n', 'piece', 'pieces', 'piece based', 'piece-based'].includes(normalized)) {
        return false;
    }
    return fallback;
};
const fetchFullProductForCache = async (requestPool, id) => {
    if (!id) return null;
    const barcodeSelect = (await hasBarcodeColumn(requestPool))
        ? 'barcode'
        : 'NULL::text AS barcode';
    const result = await requestPool.query(
        `SELECT id,
                name,
                company,
                category,
                selling_price,
                purchase_price,
                mrp,
                hsn_code,
                gst_percentage,
                is_batch_enabled,
                stock_quantity,
                is_weight_based,
                time_for_delivery,
                expiry_date,
                created_at,
                branch_id,
                ${barcodeSelect}
         FROM products
         WHERE id = $1
           AND is_deleted = FALSE
         LIMIT 1`,
        [id]
    );
    return result.rows[0] || null;
};
const {
    getProductByBarcodeFromCache,
    getProductByIdFromCache,
    upsertProductInCache,
    removeProductFromCache,
    normalizeBarcode,
    hasBarcodeColumn
} = require('../services/tenantProductCache');
const {
    cacheGet,
    cacheSet,
    buildSearchKey,
    DEFAULTS,
    invalidateProductCaches,
    invalidateSearchCache,
    invalidateOrderCaches
} = require('../services/smartCache');
const { resolveBranchIdFromRequest } = require('../utils/branch');

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
        const branchId = resolveBranchIdFromRequest(req);

        const barcodeSelect = (await hasBarcodeColumn(requestPool))
            ? 'barcode'
            : 'NULL::text AS barcode';

        let productsRes;
        let totalCountRes;
        if (branchId) {
            productsRes = await requestPool.query(
                `WITH branch_stock AS (
                    SELECT bt.product_id, COALESCE(SUM(bt.quantity), 0)::numeric AS stock_quantity
                    FROM batches bt
                    WHERE bt.branch_id = $1
                    GROUP BY bt.product_id
                )
                SELECT p.id,
                       p.name,
                       p.company AS company_name,
                       p.category AS category_name,
                       p.selling_price,
                       p.purchase_price,
                       p.mrp,
                       p.hsn_code,
                       p.gst_percentage,
                       COALESCE(bs.stock_quantity, p.stock_quantity) AS stock_quantity,
                       p.expiry_date,
                       ${barcodeSelect},
                       NULL::int AS min_stock_level,
                       p.created_at
                FROM products p
                LEFT JOIN branch_stock bs ON bs.product_id = p.id
                WHERE p.is_deleted = FALSE
                  AND (bs.product_id IS NOT NULL OR p.branch_id = $1)
                  AND ($2::text IS NULL OR p.category = $2)
                  AND (
                    $3::text IS NULL
                    OR p.name ILIKE $3
                    OR p.company ILIKE $3
                  )
                ORDER BY ${resolvedSort} ${sortOrder}, p.created_at DESC
                LIMIT $4 OFFSET $5`,
                [branchId, categoryValue, searchValue, resolvedLimit, offset]
            );
            totalCountRes = await requestPool.query(
                `WITH branch_stock AS (
                    SELECT bt.product_id
                    FROM batches bt
                    WHERE bt.branch_id = $1
                    GROUP BY bt.product_id
                )
                SELECT COUNT(*)::int AS total_records
                FROM products p
                LEFT JOIN branch_stock bs ON bs.product_id = p.id
                WHERE p.is_deleted = FALSE
                  AND (bs.product_id IS NOT NULL OR p.branch_id = $1)
                  AND ($2::text IS NULL OR p.category = $2)
                  AND (
                    $3::text IS NULL
                    OR p.name ILIKE $3
                    OR p.company ILIKE $3
                  )`,
                [branchId, categoryValue, searchValue]
            );
        } else {
            productsRes = await requestPool.query(
                `SELECT id,
                        name,
                        company AS company_name,
                        category AS category_name,
                         selling_price,
                         purchase_price,
                         mrp,
                        hsn_code,
                        gst_percentage,
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

            totalCountRes = await requestPool.query(
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
        }

        const totalRecords = Number(totalCountRes.rows[0]?.total_records || 0);
        const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / resolvedLimit);

        return res.json({
            products: attachGstList(productsRes.rows),
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
    purchase_price: purchasePriceInput,
    mrp: mrpInput,
    hsn_code: hsnCodeInput,
      hsnCode,
      time_for_delivery,
      is_weight_based,
      is_batch_enabled: isBatchEnabledInput,
      expiry_date: expiryDateInput,
      batch_number: batchNumberInput
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
  const hsn_code = hsnCodeInput ?? hsnCode;
  const purchase_price = Object.prototype.hasOwnProperty.call(req.body || {}, 'purchase_price')
    ? Number(purchasePriceInput)
    : undefined;
  const normalizedPurchasePrice = Number.isFinite(purchase_price) ? purchase_price : undefined;
  const mrp = Object.prototype.hasOwnProperty.call(req.body || {}, 'mrp')
    ? Number(mrpInput)
    : undefined;
  const normalizedMrp = Number.isFinite(mrp) ? mrp : undefined;
  const batch_number = batchNumberInput ? String(batchNumberInput).trim() : null;
  const shouldCreateBatch = Boolean(batch_number);
  const shouldEnableBatch =
    shouldCreateBatch ||
    isBatchEnabledInput === true ||
    isBatchEnabledInput === 'true' ||
    isBatchEnabledInput === 1 ||
    isBatchEnabledInput === '1';
  const gstInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'gst_percentage')
    ? Number(req.body?.gst_percentage)
    : null;
  const branchId = resolveBranchIdFromRequest(req);

  try {
    if (!product_name) {
      return res.status(400).json({ message: 'Product name is required.' });
    }
    if (selling_price === undefined) {
      return res.status(400).json({ message: 'Selling price is required.' });
    }
    if (normalizedPurchasePrice === undefined) {
      return res.status(400).json({ message: 'Purchase price is required.' });
    }
    if (stock_quantity === undefined) {
      return res.status(400).json({ message: 'Stock quantity is required.' });
    }
    const requestPool = getRequestPool(req);
    let gst_percentage = gstInput;
    if (Number.isNaN(gst_percentage)) gst_percentage = null;
    if (gst_percentage === null && hsn_code) {
      gst_percentage = await resolveGstPercentage(req, hsn_code);
    }
    if (hsn_code && gst_percentage !== null) {
      await upsertHsnGst(requestPool, hsn_code, gst_percentage);
    }
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
             purchase_price = COALESCE($2, purchase_price),
             selling_price = $3,
             mrp = COALESCE($4, mrp),
             is_weight_based = $5,
             barcode = $6,
             expiry_date = $7,
             hsn_code = $8,
             gst_percentage = $9,
             is_batch_enabled = CASE WHEN $10 THEN TRUE ELSE is_batch_enabled END,
             branch_id = COALESCE(branch_id, $11)
         WHERE id = $12
         RETURNING *`,
        [
          stock_quantity,
          normalizedPurchasePrice,
          selling_price,
          normalizedMrp,
          is_weight_based ?? existingProduct.is_weight_based ?? 0,
          resolvedBarcode,
          normalizedExpiryDate === undefined ? existingProduct.expiry_date : normalizedExpiryDate,
          hsn_code ?? existingProduct.hsn_code,
          gst_percentage ?? existingProduct.gst_percentage,
          shouldEnableBatch,
          branchId,
          existingProduct.id
        ]
      );
      if (shouldCreateBatch) {
        const batchPurchase = normalizedPurchasePrice ?? purchase_price ?? existingProduct.purchase_price ?? existingProduct.purchase_price ?? null;
        await requestPool.query(
          `INSERT INTO batches
            (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            existingProduct.id,
            branchId,
            batch_number,
            normalizedExpiryDate === undefined ? null : normalizedExpiryDate,
            batchPurchase,
            selling_price ?? existingProduct.selling_price,
            stock_quantity ?? 0
          ]
        );
      }
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
        invalidateProductCaches(tenantId, branchId, updated.rows[0]);
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
        'purchase_price',
        'company',
        'time_for_delivery',
        'is_weight_based'
      ];
      const values = [
        product_name,
        category,
        selling_price,
        stock_quantity,
        normalizedPurchasePrice,
        company,
        time_for_delivery,
        is_weight_based ?? 0
      ];
      if (hsn_code) {
        columns.push('hsn_code');
        values.push(hsn_code);
      }
      if (gst_percentage !== null && gst_percentage !== undefined) {
        columns.push('gst_percentage');
        values.push(gst_percentage);
      }
      if (normalizedExpiryDate !== undefined) {
        columns.push('expiry_date');
        values.push(normalizedExpiryDate);
      }
      if (shouldCreateBatch) {
        columns.push('is_batch_enabled');
        values.push(true);
      }
      if (normalizedMrp !== undefined) {
        columns.push('mrp');
        values.push(normalizedMrp);
      }
      if (barcodeEnabled && barcodeProvided) {
        columns.push('barcode');
        values.push(barcode);
      }
      if (branchId) {
        columns.push('branch_id');
        values.push(branchId);
      }
      const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
      const result = await requestPool.query(
        `INSERT INTO products (${columns.join(', ')})
         VALUES (${placeholders})
         RETURNING *`,
        values
      );
      if (shouldEnableBatch && !columns.includes('is_batch_enabled')) {
        columns.push('is_batch_enabled');
        values.push(true);
      }
      if (shouldCreateBatch) {
        const batchPurchase = normalizedPurchasePrice ?? null;
        await requestPool.query(
          `INSERT INTO batches
            (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            result.rows[0]?.id,
            branchId,
            batch_number,
            normalizedExpiryDate === undefined ? null : normalizedExpiryDate,
            batchPurchase,
            selling_price,
            stock_quantity ?? 0
          ]
        );
      }
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
        invalidateProductCaches(tenantId, branchId, result.rows[0]);
      }

      return res.status(201).json({
        message: 'New product added.',
        product: attachGst(result.rows[0])
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
    const {
        selling_price,
        purchase_price,
        stock_quantity,
        name,
        company,
        is_weight_based,
        hsn_code: hsnCodeInput,
        hsnCode,
        expiry_date: expiryDateInput
    } = req.body;
    const branchId = resolveBranchIdFromRequest(req);
    const expiry_date =
        Object.prototype.hasOwnProperty.call(req.body || {}, 'expiry_date') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'expiryDate')
          ? expiryDateInput ?? req.body?.expiryDate ?? null
          : undefined;
    const normalizedExpiryDate = expiry_date === '' ? null : expiry_date;
    const barcodeProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'barcode');
    const barcode = normalizeBarcode(req.body?.barcode);
    const hsn_code = hsnCodeInput ?? hsnCode;
    const gstInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'gst_percentage')
        ? Number(req.body?.gst_percentage)
        : null;
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
        //     'UPDATE products SET name = $1, category = $2, selling_price = $3, stock_quantity = $4, purchase_price = $5, company = $6 WHERE id = $7 RETURNING *',
        //     [product_name|| product.name, category || product.category, selling_price || product.selling_price, stock_quantity || product.stock_quantity,purchase_price || product.purchase_price, company || product.company, id]
        // );
        let gst_percentage = gstInput;
        if (Number.isNaN(gst_percentage)) gst_percentage = null;
        if (gst_percentage === null && hsn_code) {
            gst_percentage = await resolveGstPercentage(req, hsn_code);
        }
        if (hsn_code && gst_percentage !== null) {
            await upsertHsnGst(requestPool, hsn_code, gst_percentage);
        }

        const updateFields = [
            'name = $1',
            'company = $2',
            'selling_price = $3',
            'purchase_price = $4',
            'stock_quantity = $5',
            'is_weight_based = $6'
        ];
        const updateValues = [
            name || product.name,
            company || product.company,
            selling_price ?? product.selling_price,
            purchase_price ?? product.purchase_price,
            stock_quantity ?? product.stock_quantity,
            normalizeProductTypeFlag(is_weight_based, product.is_weight_based ?? false)
        ];
        if (hsn_code) {
            updateFields.push(`hsn_code = $${updateValues.length + 1}`);
            updateValues.push(hsn_code);
        }
        if (gst_percentage !== null && gst_percentage !== undefined) {
            updateFields.push(`gst_percentage = $${updateValues.length + 1}`);
            updateValues.push(gst_percentage);
        }
        if (normalizedExpiryDate !== undefined) {
            updateFields.push(`expiry_date = $${updateValues.length + 1}`);
            updateValues.push(normalizedExpiryDate);
        }
        if (barcodeEnabled && barcodeProvided) {
            updateFields.push(`barcode = $${updateValues.length + 1}`);
            updateValues.push(barcode);
        }
        if (branchId) {
            updateFields.push(`branch_id = $${updateValues.length + 1}`);
            updateValues.push(branchId);
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
            invalidateProductCaches(tenantId, branchId, result.rows[0]);
        }
        res.json(attachGst(result.rows[0]));
    } catch (error) {
        res.status(500).json({ error, message: 'Database error' });
    }
};

// ✅ Soft delete product
const deleteProduct = async (req, res) => {
    const { id } = req.params;
    try {
        const requestPool = getRequestPool(req);
        const branchId = resolveBranchIdFromRequest(req);
        const existingRes = await requestPool.query(
            'SELECT id, barcode FROM products WHERE id = $1',
            [id]
        );
        await requestPool.query('UPDATE products SET is_deleted = true WHERE id = $1', [id]);
        const tenantId = getTenantId(req);
        if (tenantId && existingRes.rowCount > 0) {
            removeProductFromCache(tenantId, existingRes.rows[0]);
            invalidateProductCaches(tenantId, branchId, existingRes.rows[0]);
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
        const { name, barcode, q, category, limit, lite } = req.query;
        const term = (q || name || barcode || '').toString().trim();
        const useLite =
            String(lite || '').toLowerCase() === 'true' ||
            String(lite || '') === '1' ||
            ((q || barcode || category || limit) && !name);
        if (!term && !category) {
            return res.status(400).json({ error: "Product name is required for search." });
        }
        const barcodeEnabled = req.features?.enable_barcode === true;
        const barcodeSupported = barcodeEnabled && (await hasBarcodeColumn(requestPool));
        const barcodeValue = barcodeSupported ? normalizeBarcode(q || barcode) : null;
        const branchId = resolveBranchIdFromRequest(req);
        const tenantId = getTenantId(req);

        if (view !== 'mobile' && tenantId) {
            const cacheKey = buildSearchKey(tenantId, branchId, term);
            const cached = cacheGet(cacheKey);
            if (cached) {
                // Backward compatible: keep products at top-level while adding success/data wrapper.
                return res.status(200).json({ success: true, data: { products: cached }, products: cached });
            }
        }

        if (useLite && view !== 'mobile') {
            const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
            const barcodeSelect = barcodeSupported ? 'barcode' : 'NULL::text AS barcode';
            const conditions = [];
            const values = [];
            let idx = 1;

            if (barcodeValue) {
                conditions.push(`${barcodeSelect} = $${idx}`);
                values.push(barcodeValue);
                idx += 1;
            } else if (term) {
                conditions.push(`name ILIKE $${idx}`);
                values.push(`%${term}%`);
                idx += 1;
            }
            if (category) {
                conditions.push(`category ILIKE $${idx}`);
                values.push(`%${String(category).trim()}%`);
                idx += 1;
            }
            if (branchId) {
                conditions.push(`(branch_id = $${idx} OR branch_id IS NULL)`);
                values.push(branchId);
                idx += 1;
            }

            const whereClause = conditions.length ? `AND (${conditions.join(' AND ')})` : '';
            const query = `
                SELECT
                    id,
                    name,
                    ${barcodeSelect},
                    selling_price,
                    mrp,
                    gst_percentage AS gst_percent,
                    category,
                    is_batch_enabled AS batch_enabled
                FROM products
                WHERE is_deleted = FALSE
                ${whereClause}
                ORDER BY name ASC
                LIMIT ${resolvedLimit}
            `;
            const { rows } = await requestPool.query(query, values);
            // Backward compatible: keep products at top-level while adding success/data wrapper.
            return res.status(200).json({ success: true, data: { products: rows }, products: rows });
        }

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
                  AND COALESCE(selling_price, 0) > 0
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
            return res.status(200).json({ success: true, data: { products: rows }, products: rows });
        }

        let rows = [];
        if (branchId) {
            const query = `
                WITH stock_by_branch AS (
                    SELECT bt.product_id, bt.branch_id, COALESCE(SUM(bt.quantity), 0)::numeric AS qty
                    FROM batches bt
                    GROUP BY bt.product_id, bt.branch_id
                ),
                current_branch AS (
                    SELECT s.product_id, s.qty
                    FROM stock_by_branch s
                    WHERE s.branch_id = $1
                ),
                other_branches AS (
                    SELECT s.product_id,
                           STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) AS locations
                    FROM stock_by_branch s
                    JOIN branches b ON b.id = s.branch_id
                    WHERE s.branch_id <> $1
                      AND s.qty > 0
                    GROUP BY s.product_id
                )
                SELECT p.id,
                        p.name,
                        p.company,
                        p.selling_price,
                        p.purchase_price,
                        p.mrp,
                       COALESCE(cb.qty, CASE WHEN p.branch_id = $1 THEN p.stock_quantity ELSE 0 END) AS stock_quantity,
                       p.is_weight_based,
                       CASE
                           WHEN COALESCE(cb.qty, CASE WHEN p.branch_id = $1 THEN p.stock_quantity ELSE 0 END) > 0 THEN NULL
                           WHEN ob.locations IS NOT NULL THEN CONCAT('Available in ', ob.locations)
                           ELSE NULL
                       END AS location_tag
                FROM products p
                LEFT JOIN current_branch cb ON cb.product_id = p.id
                LEFT JOIN other_branches ob ON ob.product_id = p.id
                WHERE p.is_deleted = FALSE
                  AND COALESCE(p.selling_price, 0) > 0
                  AND (
                    p.name ILIKE $2
                    OR p.company ILIKE $2
                    ${barcodeSupported ? 'OR ($3::text IS NOT NULL AND p.barcode = $3)' : ''}
                  )
                  AND (
                    COALESCE(cb.qty, CASE WHEN p.branch_id = $1 THEN p.stock_quantity ELSE 0 END) > 0
                    OR ob.locations IS NOT NULL
                  )
                ORDER BY
                  CASE WHEN COALESCE(cb.qty, CASE WHEN p.branch_id = $1 THEN p.stock_quantity ELSE 0 END) > 0 THEN 0 ELSE 1 END,
                  p.name ASC
                LIMIT 20
            `;
            const values = barcodeSupported
                ? [branchId, `%${term}%`, barcodeValue]
                : [branchId, `%${term}%`];
            ({ rows } = await requestPool.query(query, values));
        } else {
            const query = `
                SELECT
                    id,
                    name,
                    company,
                    selling_price,
                    purchase_price,
                    mrp,
                    stock_quantity,
                    is_weight_based
                FROM products
                WHERE is_deleted = FALSE
                  AND COALESCE(selling_price, 0) > 0
                  AND (
                    name ILIKE $1
                    OR company ILIKE $1
                    ${barcodeSupported ? 'OR ($2::text IS NOT NULL AND barcode = $2)' : ''}
                  )
                ORDER BY name ASC
                LIMIT 20
            `;
            const values = barcodeSupported ? [`%${term}%`, barcodeValue] : [`%${term}%`];
            ({ rows } = await requestPool.query(query, values));
        }
        if (view !== 'mobile' && tenantId) {
            const cacheKey = buildSearchKey(tenantId, branchId, term);
            cacheSet(cacheKey, rows, DEFAULTS.searchTtlMs, { tenantId });
        }
        return res.status(200).json({ success: true, data: { products: rows }, products: rows });
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
        const branchId = resolveBranchIdFromRequest(req);
        const tenantId = getTenantId(req);

        if (tenantId) {
            const cacheKey = buildSearchKey(tenantId, branchId, term);
            const cached = cacheGet(cacheKey);
            if (cached) {
                return res.status(200).json({ success: true, data: { products: cached }, products: cached });
            }
        }

        const query = `
            SELECT
                id,
                name,
                selling_price,
                purchase_price,
                mrp,
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
        if (tenantId) {
            const cacheKey = buildSearchKey(tenantId, branchId, term);
            cacheSet(cacheKey, rows, DEFAULTS.searchTtlMs, { tenantId });
        }
        // Backward compatible: keep products at top-level while adding success/data wrapper.
        return res.status(200).json({ success: true, data: { products: rows }, products: rows });
    } catch (error) {
        console.error("Error searching products for purchase:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}

const getProductsPosLite = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const branchId = resolveBranchIdFromRequest(req);
        const barcodeSelect = (await hasBarcodeColumn(requestPool))
            ? 'barcode'
            : 'NULL::text AS barcode';
        const rawLimit = parseInt(req.query?.limit, 10);
        const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 2000, 1), 5000);
        const query = `
            SELECT
                id,
                name,
                ${barcodeSelect},
                selling_price,
                gst_percentage AS gst_percent,
                category
            FROM products
            WHERE is_deleted = FALSE
              AND ($1::uuid IS NULL OR branch_id = $1 OR branch_id IS NULL)
            ORDER BY name ASC
            LIMIT $2
        `;
        const { rows } = await requestPool.query(query, [branchId, limit]);
        return res.status(200).json({ success: true, data: { products: rows }, products: rows });
    } catch (error) {
        console.error("Error loading POS lite products:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

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
        const branchId = resolveBranchIdFromRequest(req);

        if (branchId) {
            const result = await requestPool.query(
                `WITH stock_by_branch AS (
                    SELECT bt.product_id, bt.branch_id, COALESCE(SUM(bt.quantity), 0)::numeric AS qty
                    FROM batches bt
                    GROUP BY bt.product_id, bt.branch_id
                ),
                current_branch AS (
                    SELECT s.product_id, s.qty
                    FROM stock_by_branch s
                    WHERE s.branch_id = $1
                ),
                other_branches AS (
                    SELECT s.product_id,
                           STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) AS locations
                    FROM stock_by_branch s
                    JOIN branches b ON b.id = s.branch_id
                    WHERE s.branch_id <> $1
                      AND s.qty > 0
                    GROUP BY s.product_id
                )
                SELECT p.id,
                        p.name,
                        p.company,
                        p.category,
                        p.selling_price,
                        p.purchase_price,
                        p.mrp,
                        p.gst_percentage,
                       COALESCE(cb.qty, CASE WHEN p.branch_id = $1 THEN p.stock_quantity ELSE 0 END) AS stock_quantity,
                       p.is_weight_based,
                       p.barcode,
                       p.hsn_code,
                       CASE
                           WHEN COALESCE(cb.qty, CASE WHEN p.branch_id = $1 THEN p.stock_quantity ELSE 0 END) > 0 THEN NULL
                           WHEN ob.locations IS NOT NULL THEN CONCAT('Available in ', ob.locations)
                           ELSE NULL
                       END AS location_tag
                FROM products p
                LEFT JOIN current_branch cb ON cb.product_id = p.id
                LEFT JOIN other_branches ob ON ob.product_id = p.id
                WHERE p.barcode = $2
                  AND p.is_deleted = FALSE
                  AND COALESCE(p.selling_price, 0) > 0
                  AND (COALESCE(cb.qty, CASE WHEN p.branch_id = $1 THEN p.stock_quantity ELSE 0 END) > 0 OR ob.locations IS NOT NULL)
                LIMIT 1`,
                [branchId, code]
            );
            const product = result.rows[0] || null;
            if (product) {
                return res.status(200).json({ product: attachGst(product) });
            }
        }

        const tenantId = getTenantId(req);
        if (tenantId) {
            const start = Date.now();
            const cached = getProductByBarcodeFromCache(tenantId, code, branchId);
            if (cached) {
                if (Number(cached.selling_price || 0) <= 0) {
                    return res.status(404).json({ error: "Product not found." });
                }
                console.log(`[Cache HIT] barcode lookup ${Date.now() - start}ms`);
                const product = {
                    id: cached.id,
                    name: cached.name,
                    company: cached.company,
                    category: cached.category,
                    selling_price: cached.selling_price,
                    purchase_price: cached.purchase_price,
                    mrp: cached.mrp,
                    stock_quantity: cached.stock_quantity,
                    is_weight_based: cached.is_weight_based,
                    barcode: cached.barcode,
                    hsn_code: cached.hsn_code,
                    gst_percentage: cached.gst_percentage
                };
                return res.status(200).json({ product: attachGst(product) });
            }
            console.log(`[Cache MISS] barcode lookup ${Date.now() - start}ms`);
        }

        const result = await requestPool.query(
            `SELECT id,
                    name,
                    company,
                    category,
                    selling_price,
                    purchase_price,
                    mrp,
                    stock_quantity,
                    is_weight_based,
                    barcode,
                    hsn_code,
                    gst_percentage
             FROM products
             WHERE barcode = $1
               AND is_deleted = FALSE
               AND COALESCE(selling_price, 0) > 0
             LIMIT 1`,
            [code]
        );
        const product = result.rows[0] || null;
        if (product) {
            if (tenantId) {
                const fullProduct = await fetchFullProductForCache(requestPool, product.id);
                if (fullProduct) {
                    upsertProductInCache(tenantId, fullProduct);
                }
            }
            return res.status(200).json({ product: attachGst(product) });
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
        const branchId = resolveBranchIdFromRequest(req);

        const barcodeSelect = (await hasBarcodeColumn(requestPool))
            ? 'barcode'
            : 'NULL::text AS barcode';
        const result = branchId
            ? await requestPool.query(
                `WITH branch_stock AS (
                    SELECT product_id, COALESCE(SUM(quantity), 0)::numeric AS stock_quantity
                    FROM batches
                    WHERE branch_id = $1
                    GROUP BY product_id
                )
                SELECT p.id,
                       p.name,
                       p.company,
                       p.category,
                       p.selling_price,
                       p.purchase_price,
                       p.mrp,
                       p.hsn_code,
                       p.gst_percentage,
                       p.is_batch_enabled,
                       COALESCE(bs.stock_quantity, p.stock_quantity) AS stock_quantity,
                       p.is_weight_based,
                       p.time_for_delivery,
                       p.expiry_date,
                       p.created_at,
                       ${barcodeSelect}
                FROM products p
                LEFT JOIN branch_stock bs ON bs.product_id = p.id
                WHERE p.is_deleted = FALSE
                  AND (bs.product_id IS NOT NULL OR p.branch_id = $1)`,
                [branchId]
              )
            : await requestPool.query(
                `SELECT id,
                        name,
                        company,
                        category,
                        selling_price,
                        purchase_price,
                        mrp,
                        hsn_code,
                        gst_percentage,
                        is_batch_enabled,
                        stock_quantity,
                        is_weight_based,
                        time_for_delivery,
                        expiry_date,
                        created_at,
                        ${barcodeSelect}
                 FROM products
                 WHERE is_deleted = FALSE`
              );
        const batchesRes = branchId
            ? await requestPool.query(
                `SELECT id,
                        product_id,
                        branch_id,
                        batch_number,
                        expiry_date,
                        purchase_price,
                        selling_price,
                        quantity,
                        created_at
                 FROM batches
                 WHERE branch_id = $1`,
                [branchId]
              )
            : await requestPool.query(
                `SELECT id,
                        product_id,
                        branch_id,
                        batch_number,
                        expiry_date,
                        purchase_price,
                        selling_price,
                        quantity,
                        created_at
                 FROM batches`
              );
          return res.status(200).json({
              products: attachGstList(result.rows),
              batches: batchesRes.rows || []
          });
    } catch (error) {
        console.error('Error fetching cacheDB products:', error);
        return res.status(500).json({ error: 'Database error' });
    }
};

// ✅ Lightweight cache endpoint for fast billing lookups
const getProductsCache = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const tenantId = getTenantId(req);
        const branchId = resolveBranchIdFromRequest(req);
        const rawBarcode = req.query?.barcode;
        const rawSearch = req.query?.search;
        const barcode = typeof rawBarcode === 'string' ? rawBarcode.trim() : '';
        const search = typeof rawSearch === 'string' ? rawSearch.trim() : '';

        if (barcode) {
            if (tenantId) {
                const cached = getProductByBarcodeFromCache(tenantId, barcode, branchId);
                if (cached) {
                    return res.status(200).json({ products: attachGstList([cached]) });
                }
            }
            const result = await requestPool.query(
                `SELECT id,
                        name,
                          barcode,
                          selling_price,
                          purchase_price,
                          mrp,
                          stock_quantity,
                          is_weight_based,
                          expiry_date,
                          hsn_code,
                          gst_percentage
                   FROM products
                   WHERE barcode = $1
                     AND is_deleted = FALSE
                 LIMIT 1`,
                [barcode]
            );
            if (tenantId && result.rows[0]) {
                const fullProduct = await fetchFullProductForCache(requestPool, result.rows[0].id);
                if (fullProduct) {
                    upsertProductInCache(tenantId, fullProduct);
                }
            }
            return res.status(200).json({ products: attachGstList(result.rows) });
        }

        if (search) {
            if (tenantId) {
                const cacheKey = buildSearchKey(tenantId, branchId, search);
                const cached = cacheGet(cacheKey);
                if (cached) {
                    return res.status(200).json({ products: attachGstList(cached) });
                }
            }
            const result = await requestPool.query(
                `SELECT id,
                        name,
                          barcode,
                          selling_price,
                          purchase_price,
                          mrp,
                          stock_quantity,
                          is_weight_based,
                          expiry_date,
                          hsn_code,
                          gst_percentage
                   FROM products
                   WHERE name ILIKE $1
                   AND is_deleted = FALSE
                 LIMIT 20`,
                [`%${search}%`]
            );
            if (tenantId) {
                const cacheKey = buildSearchKey(tenantId, branchId, search);
                cacheSet(cacheKey, result.rows, DEFAULTS.searchTtlMs, { tenantId });
            }
            return res.status(200).json({ products: attachGstList(result.rows) });
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
        const branchId = resolveBranchIdFromRequest(req);
        if (tenantId) {
            const start = Date.now();
            const cached = getProductByBarcodeFromCache(tenantId, code, branchId);
            if (cached) {
                console.log(`[Cache HIT] barcode lookup ${Date.now() - start}ms`);
                const product = {
                    id: cached.id,
                    name: cached.name,
                    selling_price: cached.selling_price,
                    purchase_price: cached.purchase_price,
                    mrp: cached.mrp,
                    company: cached.company,
                    stock_quantity: cached.stock_quantity,
                    type: cached.is_weight_based,
                    is_weight_based: cached.is_weight_based,
                    time_for_delivery: cached.time_for_delivery,
                    category: cached.category,
                    barcode: cached.barcode,
                    hsn_code: cached.hsn_code,
                    gst_percentage: cached.gst_percentage
                };
                return res.status(200).json({ product: attachGst(product) });
            }
            console.log(`[Cache MISS] barcode lookup ${Date.now() - start}ms`);
        }

        const result = await requestPool.query(
            `SELECT
                id,
                name,
                selling_price,
                purchase_price,
                mrp,
                company,
                stock_quantity,
                is_weight_based AS type,
                is_weight_based,
                time_for_delivery,
                category,
                barcode,
                hsn_code,
                gst_percentage
             FROM products
             WHERE barcode = $1
               AND is_deleted = FALSE
             LIMIT 1`,
            [code]
        );
        const product = result.rows[0] || null;
        if (product) {
            if (tenantId) {
                const fullProduct = await fetchFullProductForCache(requestPool, product.id);
                if (fullProduct) {
                    upsertProductInCache(tenantId, fullProduct);
                }
            }
            return res.status(200).json({ product: attachGst(product) });
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
        const tenantId = getTenantId(req);
        if (tenantId) {
            const cached = getProductByIdFromCache(tenantId, id);
            if (cached) {
                return res.status(200).json({ product: attachGst(cached) });
            }
        }
        const barcodeSelect = (await hasBarcodeColumn(requestPool))
            ? 'barcode'
            : 'NULL::text AS barcode';

        const result = await requestPool.query(
            `SELECT id,
                    name,
                    company,
                      category,
                      selling_price,
                      purchase_price,
                      mrp,
                      hsn_code,
                      gst_percentage,
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
        if (tenantId) {
            upsertProductInCache(tenantId, product);
        }

        return res.status(200).json({ product: attachGst(product) });
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
    bulkUpdateProducts,
    getProductById,
    searchProductsForSale,
    searchProductsForPurchase,
    getProductByBarcodeForSale,
    getProductByBarcodeForPurchase,
    getProductsPosLite,
    getProductsCache,
    getProductsCacheDB,
    getProductsExtraDetails
};

// ✅ Bulk update products (table edit)
async function bulkUpdateProducts(req, res) {
    const requestPool = getRequestPool(req);
    const payload = req.body?.products ?? req.body;
    if (!Array.isArray(payload) || payload.length === 0) {
        return res.status(400).json({ message: 'products must be a non-empty array.' });
    }
    const branchId = resolveBranchIdFromRequest(req);
    const tenantId = getTenantId(req);

    const client = await requestPool.connect();
    try {
        await client.query('BEGIN');

        for (const item of payload) {
            const rawId = item?.id;
            const id = Number(rawId);
            if (!Number.isFinite(id)) {
                throw new Error('Valid product id is required.');
            }

            const fields = [];
            const values = [];

            const addField = (column, value) => {
                fields.push(`${column} = $${values.length + 1}`);
                values.push(value);
            };

            if (item.hasOwnProperty('selling_price')) {
                const price = Number(item.selling_price);
                if (!Number.isFinite(price) || price < 0) {
                    throw new Error('selling_price must be >= 0');
                }
                addField('selling_price', price);
            }
            if (item.hasOwnProperty('mrp')) {
                const mrp = Number(item.mrp);
                if (!Number.isFinite(mrp) || mrp < 0) {
                    throw new Error('mrp must be >= 0');
                }
                addField('mrp', mrp);
            }
            if (item.hasOwnProperty('purchase_price')) {
                const purchasePrice = Number(item.purchase_price);
                if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
                    throw new Error('purchase_price must be >= 0');
                }
                addField('purchase_price', purchasePrice);
            }
            if (item.hasOwnProperty('category')) {
                addField('category', item.category ?? null);
            }
            if (item.hasOwnProperty('hsn_code')) {
                addField('hsn_code', item.hsn_code ?? null);
            }
            if (item.hasOwnProperty('gst_percentage')) {
                const rawGst = item.gst_percentage;
                if (rawGst === '' || rawGst === null || rawGst === undefined) {
                    addField('gst_percentage', null);
                } else {
                    const gstValue = Number(rawGst);
                    if (!Number.isFinite(gstValue) || gstValue < 0) {
                        throw new Error('gst_percentage must be >= 0');
                    }
                    addField('gst_percentage', gstValue);
                }
            }
            if (item.hasOwnProperty('stock_quantity')) {
                const stockQuantity = Number(item.stock_quantity);
                if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
                    throw new Error('stock_quantity must be >= 0');
                }
                addField('stock_quantity', stockQuantity);
            }
            if (item.hasOwnProperty('is_weight_based')) {
                addField('is_weight_based', normalizeProductTypeFlag(item.is_weight_based, false));
            }

            if (fields.length === 0) {
                throw new Error(`No updatable fields provided for product ${id}`);
            }

            values.push(id);
            await client.query(
                `UPDATE products SET ${fields.join(', ')} WHERE id = $${values.length}`,
                values
            );
        }

        await client.query('COMMIT');
        if (tenantId) {
            const ids = payload
                .map((item) => Number(item?.id))
                .filter((value) => Number.isFinite(value));
            if (ids.length > 0) {
                const barcodeSelect = (await hasBarcodeColumn(requestPool))
                    ? 'barcode'
                    : 'NULL::text AS barcode';
                const updatedRes = await requestPool.query(
                    `SELECT id,
                            name,
                            company,
                            category,
                            selling_price,
                            purchase_price,
                            mrp,
                            hsn_code,
                            gst_percentage,
                            is_batch_enabled,
                            stock_quantity,
                            is_weight_based,
                            time_for_delivery,
                            expiry_date,
                            created_at,
                            branch_id,
                            ${barcodeSelect}
                     FROM products
                     WHERE id = ANY($1::int[])`,
                    [ids]
                );
                invalidateSearchCache(tenantId, branchId);
                invalidateOrderCaches(tenantId, branchId);
                for (const row of updatedRes.rows) {
                    removeProductFromCache(tenantId, row);
                    upsertProductInCache(tenantId, row);
                }
            }
        }
        return res.status(200).json({ success: true, data: { updated: payload.length } });
    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: error.message || 'Bulk update failed.' });
    } finally {
        client.release();
    }
}

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
                      purchase_price,
                      mrp,
                      category,
                      company,
                      expiry_date,
                      hsn_code,
                      gst_percentage
               FROM products
               WHERE is_deleted = FALSE
               ${whereClause}`,
            values
        );

        return res.status(200).json({ products: attachGstList(result.rows) });
    } catch (error) {
        console.error('Error fetching extra product details:', error);
        return res.status(500).json({ error: 'Database error' });
    }
}

