class CategoryRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findMany({ search, offset, limit }) {
    const params = [];
    let having = "WHERE category IS NOT NULL AND TRIM(category) <> ''";
    if (search) {
      params.push(`%${search}%`);
      having += ` AND category ILIKE $${params.length}`;
    }

    const countRes = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT DISTINCT TRIM(category) AS category
         FROM products
         WHERE is_deleted = FALSE AND category IS NOT NULL AND TRIM(category) <> ''
         ${search ? `AND category ILIKE $1` : ''}
       ) c`,
      search ? params : []
    );

    const listRes = await this.pool.query(
      `SELECT TRIM(category) AS name, COUNT(*)::int AS product_count
       FROM products
       WHERE is_deleted = FALSE AND category IS NOT NULL AND TRIM(category) <> ''
       ${search ? `AND category ILIKE $1` : ''}
       GROUP BY TRIM(category)
       ORDER BY name ASC
       OFFSET $${search ? 2 : 1} LIMIT $${search ? 3 : 2}`,
      search ? [...params, offset, limit] : [offset, limit]
    );

    return { rows: listRes.rows, total: countRes.rows[0]?.total || 0 };
  }

  async findProductsByCategory(name, offset, limit) {
    const countRes = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM products
       WHERE is_deleted = FALSE AND LOWER(TRIM(category)) = LOWER(TRIM($1))`,
      [name]
    );
    const listRes = await this.pool.query(
      `SELECT id, name, category, selling_price, stock_quantity, barcode, created_at
       FROM products
       WHERE is_deleted = FALSE AND LOWER(TRIM(category)) = LOWER(TRIM($1))
       ORDER BY name ASC
       OFFSET $2 LIMIT $3`,
      [name, offset, limit]
    );
    return { rows: listRes.rows, total: countRes.rows[0]?.total || 0 };
  }

  async renameCategory(oldName, newName) {
    const res = await this.pool.query(
      `UPDATE products SET category = $2, updated_at = NOW()
       WHERE is_deleted = FALSE AND LOWER(TRIM(category)) = LOWER(TRIM($1))
       RETURNING id`,
      [oldName, newName]
    );
    return res.rowCount;
  }

  async deleteCategory(name) {
    const res = await this.pool.query(
      `UPDATE products SET category = NULL, updated_at = NOW()
       WHERE is_deleted = FALSE AND LOWER(TRIM(category)) = LOWER(TRIM($1))
       RETURNING id`,
      [name]
    );
    return res.rowCount;
  }
}

module.exports = { CategoryRepository };
