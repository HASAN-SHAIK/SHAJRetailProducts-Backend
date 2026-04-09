const { jsonError, jsonOk } = require('../../utils/responses');

const searchCustomers = async (req, res) => {
  try {
    const tenantPool = req.tenantPool;
    const term = (req.query.q || req.query.name || req.query.phone || '').toString().trim();
    const rawLimit = Number(req.query?.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;
    if (!term) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Search term is required');
    }

    const result = await tenantPool.query(
      `SELECT id, name, mobile, address, location, 0::numeric AS outstanding_balance
       FROM customers
       WHERE LOWER(name) LIKE LOWER($1) OR mobile LIKE $1
       ORDER BY name ASC
       LIMIT $2`,
      [`%${term}%`, limit]
    );

    // Backward compatible: keep customers at top-level while adding success/data wrapper.
    return res.status(200).json({
      success: true,
      data: { customers: result.rows },
      customers: result.rows
    });
  } catch (error) {
    return jsonError(res, 500, 'CUSTOMER_SEARCH_FAILED', 'Failed to search customers');
  }
};

const getCustomers = async (req, res) => {
  try {
    const tenantPool = req.tenantPool;
    const rawLimit = Number(req.query?.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : 1000;
    const result = await tenantPool.query(
      `SELECT id, name, mobile, address, location
       FROM customers
       ORDER BY name ASC
       LIMIT $1`,
      [limit]
    );
    return jsonOk(res, { customers: result.rows });
  } catch (error) {
    return jsonError(res, 500, 'CUSTOMER_LIST_FAILED', 'Failed to load customers');
  }
};

module.exports = { searchCustomers, getCustomers };
