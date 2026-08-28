const { resolveBranchIdFromRequest } = require('../../../../utils/branch');

class ProductRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async hasBarcodeColumn() {
    const res = await this.pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'barcode'
       LIMIT 1`
    );
    return res.rowCount > 0;
  }

  async findMany({ branchId, search, category, offset, limit, sortColumn, sortOrder }) {
    const conditions = ['is_deleted = FALSE'];
    const params = [];
    let idx = 1;

    if (branchId) {
      conditions.push(`(branch_id = $${idx} OR branch_id IS NULL)`);
      params.push(branchId);
      idx += 1;
    }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR company ILIKE $${idx} OR barcode ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx += 1;
    }
    if (category) {
      conditions.push(`LOWER(TRIM(category)) = LOWER(TRIM($${idx}))`);
      params.push(category);
      idx += 1;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await this.pool.query(`SELECT COUNT(*)::int AS total FROM products ${where}`, params);
    const total = countRes.rows[0]?.total || 0;

    const listRes = await this.pool.query(
      `SELECT id, name, category, company, selling_price, mrp, purchase_price, hsn_code,
              gst_percentage, is_weight_based, is_batch_enabled, stock_quantity, barcode,
              branch_id, expiry_date, created_at, updated_at
       FROM products
       ${where}
       ORDER BY ${sortColumn} ${sortOrder}
       OFFSET $${idx} LIMIT $${idx + 1}`,
      [...params, offset, limit]
    );

    return { rows: listRes.rows, total };
  }

  async findBranchInventoryFacts({ branchId, productIds }) {
    if (!branchId || !Array.isArray(productIds) || productIds.length === 0) return [];

    const normalizedIds = [...new Set(productIds.map((id) => Number(id)).filter(Number.isSafeInteger))];
    if (normalizedIds.length === 0) return [];

    const res = await this.pool.query(
      `WITH batch_truth AS (
         SELECT b.product_id,
                COALESCE(SUM(COALESCE(b.quantity_remaining, b.quantity)), 0)::numeric AS physical_quantity,
                COALESCE(SUM(CASE
                  WHEN b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE
                    THEN COALESCE(b.quantity_remaining, b.quantity)
                  ELSE 0
                END), 0)::numeric AS sellable_quantity,
                COALESCE(SUM(CASE
                  WHEN b.expiry_date < CURRENT_DATE
                    THEN COALESCE(b.quantity_remaining, b.quantity)
                  ELSE 0
                END), 0)::numeric AS expired_quantity
         FROM batches b
         WHERE b.branch_id = $1::uuid
           AND b.is_deleted = FALSE
           AND b.product_id = ANY($2::bigint[])
         GROUP BY b.product_id
       ),
       provisional_deficit AS (
         SELECT a.product_id,
                (SUM(CASE
                   WHEN a.source_movement_type = 'sale_issue' THEN a.quantity_milli
                   WHEN a.source_movement_type = 'sale_return' THEN -a.quantity_milli
                   ELSE 0
                 END)::numeric / 1000.0) AS deficit_quantity
         FROM pos_inventory_batch_allocations a
         WHERE a.branch_id = $1::uuid
           AND a.product_id = ANY($2::bigint[])
           AND a.allocation_kind = 'unallocated'
         GROUP BY a.product_id
         HAVING SUM(CASE
           WHEN a.source_movement_type = 'sale_issue' THEN a.quantity_milli
           WHEN a.source_movement_type = 'sale_return' THEN -a.quantity_milli
           ELSE 0
         END) > 0
       ),
       scoped_products AS (
         SELECT p.id AS product_id,
                CASE
                  WHEN COALESCE(p.is_batch_enabled, FALSE) = TRUE THEN COALESCE(bt.physical_quantity, 0)
                  ELSE COALESCE(p.stock_quantity, 0)
                END::numeric AS physical_quantity,
                CASE
                  WHEN COALESCE(p.is_batch_enabled, FALSE) = TRUE THEN COALESCE(bt.sellable_quantity, 0)
                  WHEN p.expiry_date IS NOT NULL AND p.expiry_date < CURRENT_DATE THEN 0
                  ELSE COALESCE(p.stock_quantity, 0)
                END::numeric AS sellable_quantity,
                CASE
                  WHEN COALESCE(p.is_batch_enabled, FALSE) = TRUE THEN COALESCE(bt.expired_quantity, 0)
                  WHEN p.expiry_date IS NOT NULL AND p.expiry_date < CURRENT_DATE THEN COALESCE(p.stock_quantity, 0)
                  ELSE 0
                END::numeric AS expired_quantity,
                CASE
                  WHEN COALESCE(p.is_batch_enabled, FALSE) = TRUE THEN COALESCE(pd.deficit_quantity, 0)
                  ELSE 0
                END::numeric AS provisional_deficit
         FROM products p
         LEFT JOIN batch_truth bt ON bt.product_id = p.id
         LEFT JOIN provisional_deficit pd ON pd.product_id = p.id
         WHERE p.is_deleted = FALSE
           AND p.id = ANY($2::bigint[])
           AND (
             (COALESCE(p.is_batch_enabled, FALSE) = FALSE AND p.branch_id = $1::uuid)
             OR
             (COALESCE(p.is_batch_enabled, FALSE) = TRUE AND (
               p.branch_id = $1::uuid
               OR bt.product_id IS NOT NULL
               OR pd.product_id IS NOT NULL
             ))
           )
       )
       SELECT product_id,
              physical_quantity,
              sellable_quantity,
              expired_quantity,
              provisional_deficit,
              (sellable_quantity - provisional_deficit)::numeric AS projected_net_quantity
       FROM scoped_products`,
      [branchId, normalizedIds]
    );

    return res.rows;
  }

  async findById(id) {
    const res = await this.pool.query(
      `SELECT * FROM products WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    return res.rows[0] || null;
  }

  async findByBarcode(barcode, branchId = null) {
    const hasBarcode = await this.hasBarcodeColumn();
    if (!hasBarcode) return null;
    const params = [barcode];
    let branchClause = '';
    if (branchId) {
      params.push(branchId);
      branchClause = ' AND (branch_id = $2 OR branch_id IS NULL)';
    }
    const res = await this.pool.query(
      `SELECT * FROM products WHERE barcode = $1 AND is_deleted = FALSE${branchClause} LIMIT 1`,
      params
    );
    return res.rows[0] || null;
  }

  async create(payload) {
    const res = await this.pool.query(
      `INSERT INTO products (
         name, category, company, selling_price, mrp, purchase_price, hsn_code,
         gst_percentage, is_weight_based, is_batch_enabled, stock_quantity, barcode,
         branch_id, expiry_date, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       RETURNING *`,
      [
        payload.name,
        payload.category || null,
        payload.company || null,
        payload.selling_price,
        payload.mrp ?? null,
        payload.purchase_price ?? null,
        payload.hsn_code || null,
        payload.gst_percentage ?? 0,
        Boolean(payload.is_weight_based),
        Boolean(payload.is_batch_enabled),
        payload.stock_quantity ?? 0,
        payload.barcode || null,
        payload.branch_id || null,
        payload.expiry_date || null,
      ]
    );
    return res.rows[0];
  }

  async update(id, payload) {
    const res = await this.pool.query(
      `UPDATE products
       SET name = COALESCE($1, name),
           category = COALESCE($2, category),
           company = COALESCE($3, company),
           selling_price = COALESCE($4, selling_price),
           mrp = COALESCE($5, mrp),
           purchase_price = COALESCE($6, purchase_price),
           hsn_code = COALESCE($7, hsn_code),
           gst_percentage = COALESCE($8, gst_percentage),
           is_weight_based = COALESCE($9, is_weight_based),
           is_batch_enabled = COALESCE($10, is_batch_enabled),
           stock_quantity = COALESCE($11, stock_quantity),
           barcode = COALESCE($12, barcode),
           branch_id = COALESCE($13, branch_id),
           expiry_date = COALESCE($14, expiry_date),
           updated_at = NOW()
       WHERE id = $15 AND is_deleted = FALSE
       RETURNING *`,
      [
        payload.name ?? null,
        payload.category ?? null,
        payload.company ?? null,
        payload.selling_price ?? null,
        payload.mrp ?? null,
        payload.purchase_price ?? null,
        payload.hsn_code ?? null,
        payload.gst_percentage ?? null,
        payload.is_weight_based ?? null,
        payload.is_batch_enabled ?? null,
        payload.stock_quantity ?? null,
        payload.barcode ?? null,
        payload.branch_id ?? null,
        payload.expiry_date ?? null,
        id,
      ]
    );
    return res.rows[0] || null;
  }

  async softDelete(id) {
    const res = await this.pool.query(
      `UPDATE products SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND is_deleted = FALSE RETURNING id`,
      [id]
    );
    return res.rowCount > 0;
  }
}

const createProductRepository = (req) =>
  new ProductRepository(req.tenantPool);

const resolveBranch = (req) => resolveBranchIdFromRequest(req);

module.exports = { ProductRepository, createProductRepository, resolveBranch };
