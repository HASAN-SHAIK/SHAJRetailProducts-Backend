const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');
const { setStockAuditContext } = require('./stockAuditService');

const getRequestPool = (req) => req.tenantPool || pool;

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const buildNotFoundError = (message) => {
  const err = new Error(message);
  err.status = 404;
  return err;
};

const getBranchStock = async (req, productIdRaw) => {
  const requestPool = getRequestPool(req);
  const productId = Number(productIdRaw);
  if (!Number.isFinite(productId)) {
    throw buildValidationError('product_id is required.');
  }

  const branchId = resolveBranchIdFromRequest(req);
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
     WHERE ($2::uuid IS NULL OR b.id = $2::uuid)
     ORDER BY b.name ASC`,
    [productId, branchId]
  );

  return result.rows.map((row) => ({
    branch_id: row.id,
    branch: row.name,
    quantity: Number(row.quantity || 0)
  }));
};

const adjustStock = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const productId = Number(payload.product_id ?? payload.productId);
  const deltaQuantity = Number(payload.delta_quantity ?? payload.deltaQuantity);
  const batchId = payload.batch_id ?? payload.batchId ?? null;
  const reason = String(payload.reason || '').trim();
  const referenceId = payload.reference_id ?? payload.referenceId ?? null;
  const branchId = resolveBranchIdFromRequest(req);

  if (!Number.isInteger(productId) || productId <= 0) {
    throw buildValidationError('product_id is required.');
  }
  if (!Number.isFinite(deltaQuantity) || deltaQuantity === 0) {
    throw buildValidationError('delta_quantity must be a non-zero number.');
  }
  if (!reason) {
    throw buildValidationError('reason is required.');
  }
  if (!branchId) {
    throw buildValidationError('branch_id is required for stock adjustment.');
  }

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');
    await setStockAuditContext(client, req, {
      reason,
      source: 'manual_adjustment',
      reference: referenceId
    });

    const productResult = await client.query(
      `SELECT id, stock_quantity, is_batch_enabled, branch_id
       FROM products
       WHERE id = $1
         AND is_deleted = FALSE
       FOR UPDATE`,
      [productId]
    );
    if (productResult.rowCount === 0) {
      throw buildNotFoundError('Product not found.');
    }

    const product = productResult.rows[0];
    const beforeQuantity = Number(product.stock_quantity || 0);
    const afterQuantity = beforeQuantity + deltaQuantity;
    if (afterQuantity < 0) {
      throw buildValidationError('Stock adjustment cannot make canonical stock negative.');
    }

    if (product.is_batch_enabled) {
      if (!batchId) {
        throw buildValidationError('batch_id is required for batch-enabled product adjustment.');
      }
      const batchResult = await client.query(
        `SELECT id, product_id, branch_id,
                COALESCE(quantity, 0)::numeric AS quantity,
                COALESCE(quantity_remaining, quantity, 0)::numeric AS quantity_remaining
         FROM batches
         WHERE id = $1
           AND product_id = $2
           AND branch_id = $3::uuid
           AND is_deleted = FALSE
         FOR UPDATE`,
        [batchId, productId, branchId]
      );
      if (batchResult.rowCount === 0) {
        throw buildNotFoundError('Batch not found for selected product and branch.');
      }
      const batch = batchResult.rows[0];
      const nextBatchQuantity = Number(batch.quantity || 0) + deltaQuantity;
      const nextBatchRemaining = Number(batch.quantity_remaining || 0) + deltaQuantity;
      if (nextBatchQuantity < 0 || nextBatchRemaining < 0) {
        throw buildValidationError('Stock adjustment cannot make batch stock negative.');
      }
      await client.query(
        `UPDATE batches
         SET quantity = COALESCE(quantity, 0) + $1,
             quantity_remaining = COALESCE(quantity_remaining, quantity, 0) + $1
         WHERE id = $2`,
        [deltaQuantity, batchId]
      );
    } else if (!product.branch_id || String(product.branch_id) !== String(branchId)) {
      throw buildValidationError('Non-batch product does not belong to selected branch.');
    }

    const updatedResult = await client.query(
      `UPDATE products
       SET stock_quantity = $1
       WHERE id = $2
       RETURNING id, stock_quantity`,
      [afterQuantity, productId]
    );

    await client.query('COMMIT');
    return {
      product_id: productId,
      branch_id: branchId,
      batch_id: batchId,
      delta_quantity: deltaQuantity,
      before_quantity: beforeQuantity,
      after_quantity: Number(updatedResult.rows[0]?.stock_quantity ?? afterQuantity),
      reason,
      reference_id: referenceId
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { getBranchStock, adjustStock };
