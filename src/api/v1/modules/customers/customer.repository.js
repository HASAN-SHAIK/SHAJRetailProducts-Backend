const legacyCustomerService = require('../../../../modules/customers/service');

class CustomerRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findMany({ search, offset, limit, sortColumn, sortOrder }) {
    const term = String(search || '').trim();
    const dedupeExpr = `COALESCE(NULLIF(regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g'), ''), CONCAT('name:', LOWER(TRIM(COALESCE(name, '')))))`;
    const params = [];
    let whereClause = '';
    if (term) {
      params.push(`%${term}%`);
      whereClause = `WHERE LOWER(name) LIKE LOWER($1) OR COALESCE(phone, mobile, '') LIKE $1 OR LOWER(COALESCE(shop_name, '')) LIKE LOWER($1)`;
    }

    const countRes = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT DISTINCT ON (${dedupeExpr}) id FROM customers ${whereClause}
         ORDER BY ${dedupeExpr}, updated_at DESC NULLS LAST, id DESC
       ) c`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    const listRes = await this.pool.query(
      `SELECT id, name, phone, mobile, type, current_balance, credit_limit, shop_name, gst_number, is_active, address, location, email, created_at, updated_at
       FROM (
         SELECT DISTINCT ON (${dedupeExpr})
                id, name, COALESCE(phone, mobile) AS phone, mobile, type, current_balance, credit_limit,
                shop_name, gst_number, is_active, address, location, email, created_at, updated_at,
                ${dedupeExpr} AS dedupe_key
         FROM customers
         ${whereClause}
         ORDER BY ${dedupeExpr}, updated_at DESC NULLS LAST, id DESC
       ) c
       ORDER BY ${sortColumn} ${sortOrder}
       OFFSET $${params.length + 1} LIMIT $${params.length + 2}`,
      [...params, offset, limit]
    );

    return { rows: listRes.rows, total };
  }

  async findById(id) {
    return legacyCustomerService.getCustomerById(this.pool, id);
  }

  async create(payload) {
    return legacyCustomerService.createCustomer(this.pool, payload);
  }

  async update(id, payload) {
    return legacyCustomerService.updateCustomer(this.pool, id, payload);
  }

  async deactivate(id) {
    const res = await this.pool.query(
      `UPDATE customers SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    return res.rowCount > 0;
  }
}

module.exports = { CustomerRepository };
