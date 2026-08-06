const legacySupplierService = require('../../../../modules/suppliers/service');
const { resolveBranchIdFromRequest } = require('../../../../utils/branch');

class SupplierRepository {
  constructor(pool, branchId = null) {
    this.pool = pool;
    this.branchId = branchId;
  }

  async findMany({ search, offset, limit, sortColumn, sortOrder }) {
    const term = String(search || '').trim();
    const conditions = ['is_deleted = FALSE'];
    const params = [];
    let idx = 1;

    if (this.branchId) {
      conditions.push(`(branch_id = $${idx} OR branch_id IS NULL)`);
      params.push(this.branchId);
      idx += 1;
    }
    if (term) {
      conditions.push(`(name ILIKE $${idx} OR mobile ILIKE $${idx} OR email ILIKE $${idx})`);
      params.push(`%${term}%`);
      idx += 1;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await this.pool.query(`SELECT COUNT(*)::int AS total FROM suppliers ${where}`, params);
    const total = countRes.rows[0]?.total || 0;

    const listRes = await this.pool.query(
      `SELECT id, name, mobile, email, address, gst_number, credit_limit, current_balance, branch_id, is_active, created_at, updated_at
       FROM suppliers
       ${where}
       ORDER BY ${sortColumn} ${sortOrder}
       OFFSET $${idx} LIMIT $${idx + 1}`,
      [...params, offset, limit]
    );

    return { rows: listRes.rows, total };
  }

  async findById(id) {
    return legacySupplierService.getSupplierById(this.pool, id);
  }

  async create(payload) {
    return legacySupplierService.createSupplier(this.pool, payload);
  }

  async update(id, payload) {
    return legacySupplierService.updateSupplier(this.pool, id, payload);
  }

  async softDelete(id) {
    const res = await this.pool.query(
      `UPDATE suppliers SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND is_deleted = FALSE RETURNING id`,
      [id]
    );
    return res.rowCount > 0;
  }
}

const createSupplierRepository = (req) =>
  new SupplierRepository(req.tenantPool, resolveBranchIdFromRequest(req));

module.exports = { SupplierRepository, createSupplierRepository };
