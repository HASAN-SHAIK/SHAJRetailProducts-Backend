const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const getBranchStock = async (req, productIdRaw) => {
  const requestPool = getRequestPool(req);
  const productId = Number(productIdRaw);
  if (!Number.isFinite(productId)) {
    throw buildValidationError('product_id is required.');
  }

  const result = await requestPool.query(
    `WITH batch_totals AS (
        SELECT branch_id, COALESCE(SUM(COALESCE(quantity_remaining, quantity)), 0)::numeric AS qty
        FROM batches
        WHERE product_id = $1
          AND is_deleted = FALSE
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        GROUP BY branch_id
     )
     SELECT b.id,
            b.name,
            COALESCE(bt.qty, CASE WHEN p.branch_id = b.id THEN COALESCE(p.stock_quantity, 0) ELSE 0 END)::numeric AS quantity
     FROM branches b
     LEFT JOIN batch_totals bt ON bt.branch_id = b.id
     LEFT JOIN products p ON p.id = $1
     ORDER BY b.name ASC`,
    [productId]
  );

  return result.rows.map((row) => ({
    branch_id: row.id,
    branch: row.name,
    quantity: Number(row.quantity || 0)
  }));
};

module.exports = { getBranchStock };
