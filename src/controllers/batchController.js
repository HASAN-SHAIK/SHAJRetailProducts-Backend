const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const normalizeBatchRow = (row) => ({
  id: row.id,
  product_id: row.product_id,
  branch_id: row.branch_id ?? null,
  batch_number: row.batch_number ?? null,
  expiry_date: row.expiry_date ?? null,
  purchase_price: row.purchase_price ?? null,
  selling_price: row.selling_price ?? null,
  quantity: row.quantity ?? 0,
  created_at: row.created_at ?? null,
});

const getBatches = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);

    const query = branchId
      ? `SELECT id,
                product_id,
                branch_id,
                batch_number,
                expiry_date,
                purchase_price,
                selling_price,
                quantity,
                created_at
         FROM batches
         WHERE branch_id = $1`
      : `SELECT id,
                product_id,
                branch_id,
                batch_number,
                expiry_date,
                purchase_price,
                selling_price,
                quantity,
                created_at
         FROM batches`;

    const result = await requestPool.query(query, branchId ? [branchId] : []);
    const batches = Array.isArray(result.rows)
      ? result.rows.map(normalizeBatchRow)
      : [];
    return res.status(200).json({ batches });
  } catch (error) {
    console.error('Error fetching batches:', error);
    return res.status(500).json({ error: 'Database error' });
  }
};

module.exports = {
  getBatches,
};
