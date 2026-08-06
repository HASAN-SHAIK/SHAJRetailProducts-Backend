const purchaseService = require('../../../../services/purchaseService');
const { resolveBranchIdFromRequest } = require('../../../../utils/branch');

class PurchaseRepository {
  constructor(req) {
    this.req = req;
    this.pool = req.tenantPool;
  }

  list(query) {
    return purchaseService.listPurchases(this.req, query);
  }

  getById(id) {
    return purchaseService.getPurchaseDetail(this.req, id);
  }

  create(body) {
    return purchaseService.createPurchase(this.req, body);
  }

  async findManyPaginated(query) {
    const branchId = resolveBranchIdFromRequest(this.req) || query.branch_id || null;
    const supplierId = query.supplier_id || null;
    const startDate = query.start_date || null;
    const endDate = query.end_date || null;
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

    const conditions = ["o.transaction_type = 'purchase'", 'o.is_deleted = FALSE'];
    const params = [];
    let idx = 1;

    if (branchId) {
      conditions.push(`o.branch_id = $${idx}`);
      params.push(branchId);
      idx += 1;
    }
    if (supplierId) {
      conditions.push(`o.supplier_id = $${idx}`);
      params.push(supplierId);
      idx += 1;
    }
    if (startDate) {
      conditions.push(`o.created_at >= $${idx}`);
      params.push(startDate);
      idx += 1;
    }
    if (endDate) {
      conditions.push(`o.created_at <= $${idx}`);
      params.push(endDate);
      idx += 1;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM orders o ${where}`,
      params
    );

    const listRes = await this.pool.query(
      `SELECT o.id, o.created_at, o.total_price, COALESCE(o.total_paid, 0) AS total_paid,
              o.order_status, o.payment_mode, o.invoice_number, o.branch_id, o.supplier_id,
              s.name AS supplier_name
       FROM orders o
       LEFT JOIN suppliers s ON s.id = o.supplier_id
       ${where}
       ORDER BY o.created_at DESC
       OFFSET $${idx} LIMIT $${idx + 1}`,
      [...params, offset, limit]
    );

    return { rows: listRes.rows, total: countRes.rows[0]?.total || 0, page, limit };
  }
}

module.exports = { PurchaseRepository };
