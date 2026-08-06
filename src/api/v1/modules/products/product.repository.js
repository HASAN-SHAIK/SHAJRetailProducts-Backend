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
