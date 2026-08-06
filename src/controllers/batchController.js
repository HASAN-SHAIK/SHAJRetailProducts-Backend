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
  mrp: row.mrp ?? null,
  quantity: row.quantity ?? 0,
  quantity_remaining: row.quantity_remaining ?? row.quantity ?? 0,
  created_at: row.created_at ?? null,
  updated_at: row.updated_at ?? row.created_at ?? null,
  sync_version: row.sync_version ?? 1,
  is_deleted: row.is_deleted ?? false,
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
                mrp,
                quantity,
                quantity_remaining,
                created_at,
                updated_at,
                sync_version,
                is_deleted
         FROM batches
         WHERE branch_id = $1
           AND is_deleted = FALSE`
      : `SELECT id,
                product_id,
                branch_id,
                batch_number,
                expiry_date,
                purchase_price,
                selling_price,
                mrp,
                quantity,
                quantity_remaining,
                created_at,
                updated_at,
                sync_version,
                is_deleted
         FROM batches
         WHERE is_deleted = FALSE`;

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
