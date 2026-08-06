const { resolveBranchIdFromRequest } = require('../../../../utils/branch');
const orderController = require('../../../../controllers/orderController');

const invokeLegacyController = (handler, req, body = undefined) =>
  new Promise((resolve, reject) => {
    if (body !== undefined) req.body = body;
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400) {
          const err = new Error(payload?.message || payload?.error || 'Request failed');
          err.status = this.statusCode;
          err.code = payload?.code;
          return reject(err);
        }
        return resolve(payload);
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });

class SaleRepository {
  constructor(req) {
    this.req = req;
    this.pool = req.tenantPool;
    this.branchId = resolveBranchIdFromRequest(req);
  }

  async findManyPaginated(query) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;
    const search = String(query.search || '').trim();
    const customerId = query.customer_id || null;

    const conditions = ["transaction_type = 'sale'", 'is_deleted = FALSE'];
    const params = [];
    let idx = 1;

    if (this.branchId) {
      conditions.push(`branch_id = $${idx}`);
      params.push(this.branchId);
      idx += 1;
    }
    if (customerId) {
      conditions.push(`customer_id = $${idx}`);
      params.push(customerId);
      idx += 1;
    }
    if (search) {
      conditions.push(`(CAST(id AS TEXT) ILIKE $${idx} OR customer_name_snapshot ILIKE $${idx} OR product_summary ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx += 1;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await this.pool.query(`SELECT COUNT(*)::int AS total FROM orders ${where}`, params);
    const sortBy = ['created_at', 'total_price', 'id'].includes(String(query.sort_by)) ? query.sort_by : 'created_at';
    const sortOrder = String(query.sort_order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const listRes = await this.pool.query(
      `SELECT id, customer_id, customer_name_snapshot, customer_mobile_snapshot, total_price, total_paid,
              payment_mode, billing_type, order_status, branch_id, product_summary, product_count,
              invoice_number, created_at, updated_at
       FROM orders
       ${where}
       ORDER BY ${sortBy} ${sortOrder}
       OFFSET $${idx} LIMIT $${idx + 1}`,
      [...params, offset, limit]
    );

    return { rows: listRes.rows, total: countRes.rows[0]?.total || 0, page, limit };
  }

  async findById(id) {
    this.req.params = { ...(this.req.params || {}), id: String(id) };
    const payload = await invokeLegacyController(orderController.getOrderById, this.req);
    return payload;
  }

  create(body) {
    return invokeLegacyController(orderController.createOrder, this.req, body);
  }

  update(id, body) {
    this.req.params = { ...(this.req.params || {}), id: String(id) };
    return invokeLegacyController(orderController.updateOrder, this.req, body);
  }

  remove(id) {
    this.req.params = { ...(this.req.params || {}), id: String(id) };
    return invokeLegacyController(orderController.deleteOrder, this.req);
  }
}

module.exports = { SaleRepository, invokeLegacyController };
