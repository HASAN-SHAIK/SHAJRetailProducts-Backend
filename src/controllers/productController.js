const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const { getAuthUser } = require('../utils/auth');

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
    const allowedSorts = new Set(['name', 'selling_price', 'stock_quantity', 'created_at']);
    const resolvedSort = allowedSorts.has(sortKey) ? sortKey : 'created_at';

    const searchValue = typeof search === 'string' && search.trim() ? `%${search.trim()}%` : null;
    const categoryValue =
        typeof categoryIdRaw === 'string' && categoryIdRaw.trim() ? categoryIdRaw.trim() : null;

    try {
        const requestPool = getRequestPool(req);
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }

        const productsRes = await requestPool.query(
            `SELECT id,
                    name,
                    company AS company_name,
                    category AS category_name,
                    selling_price,
                    actual_price,
                    stock_quantity,
                    barcode,
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
             ORDER BY
               CASE WHEN $3 = 'name' THEN name END ${sortOrder},
               CASE WHEN $3 = 'selling_price' THEN selling_price END ${sortOrder},
               CASE WHEN $3 = 'stock_quantity' THEN stock_quantity END ${sortOrder},
               CASE WHEN $3 = 'created_at' THEN created_at END ${sortOrder},
               created_at DESC
             LIMIT $4 OFFSET $5`,
            [categoryValue, searchValue, resolvedSort, resolvedLimit, offset]
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
const normalizeBarcode = (value) => {
    if (value === undefined || value === null) return null;
    const trimmed = value.toString().trim();
    return trimmed ? trimmed : null;
};

// ✅ Add new product
const addProduct = async (req, res) => {
  const {
    product_name,
    category,
    selling_price,
    stock_quantity,
    company,
    actual_price,
    time_for_delivery,
    is_weight_based
  } = req.body;
  const barcodeProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'barcode');
  const barcode = normalizeBarcode(req.body?.barcode);

  try {
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
             barcode = $5
         WHERE id = $6
         RETURNING *`,
        [
          stock_quantity,
          actual_price,
          selling_price,
          is_weight_based ?? existingProduct.is_weight_based ?? 0,
          resolvedBarcode,
          existingProduct.id
        ]
      );

      return res.status(200).json({
        message: 'Product already exists. Stock and prices updated.',
        product: updated.rows[0]
      });
    } else {
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
    const {selling_price, actual_price, stock_quantity,name,company, is_weight_based } = req.body;
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
        if (barcodeEnabled && barcodeProvided) {
            updateFields.push(`barcode = $${updateValues.length + 1}`);
            updateValues.push(barcode);
        }
        updateValues.push(id);
        const result = await requestPool.query(
            `UPDATE products SET ${updateFields.join(', ')} WHERE id = $${updateValues.length} RETURNING *`,
            updateValues
        );
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
        await requestPool.query('UPDATE products SET is_deleted = true WHERE id = $1', [id]);
        res.json({ message: 'Product deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
};

const searchProducts = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const { name, barcode } = req.query;
        const term = (name || barcode || '').toString().trim();
        if (!term) {
            return res.status(400).json({ error: "Product name is required for search." });
        }

        const query = `
            SELECT
                id,
                name,
                company,
                selling_price,
                stock_quantity,
                barcode
            FROM products
            WHERE is_deleted = FALSE
              AND (name ILIKE $1 OR company ILIKE $1)
            ORDER BY name ASC
            LIMIT 20
        `;
        const values = [`%${term}%`];
        const { rows } = await requestPool.query(query, values);
        return res.status(200).json({ products: rows });
    } catch (error) {
        console.error("Error searching products:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
 }

const getProductByBarcode = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        if (req.features?.enable_barcode !== true) {
            return res.status(403).json({ error: "Barcode feature is disabled." });
        }
        const code = (req.params.barcode || req.params.code || req.query.barcode || req.query.code || '').toString().trim();
        if (!code) {
            return res.status(400).json({ error: "Barcode is required." });
        }

        const result = await requestPool.query(
            `SELECT id, name, selling_price, stock_quantity
             FROM products
             WHERE barcode = $1
               AND is_deleted = FALSE
             LIMIT 1`,
            [code]
        );
        return res.status(200).json({ product: result.rows[0] || null });
    } catch (error) {
        console.error("Error searching product by barcode:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

module.exports = { getProducts, addProduct, updateProduct, deleteProduct, searchProducts, getProductByBarcode };
