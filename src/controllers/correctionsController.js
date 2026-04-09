const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const createCorrection = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const payload = req.body || {};
    const correctionId = payload.correctionId || payload.id;
    const billId = Number(payload.billId || payload.bill_id);
    const type = String(payload.type || '').toUpperCase();
    const changes = payload.changes || null;
    const adjustedAmount = Number(payload.adjustedAmount ?? payload.adjusted_amount ?? 0);
    const taxAdjustment = Number(payload.taxAdjustment ?? payload.tax_adjustment ?? 0);

    if (!correctionId) throw buildValidationError('correctionId is required.');
    if (!Number.isFinite(billId)) throw buildValidationError('billId is required.');
    if (!type) throw buildValidationError('type is required.');

    await requestPool.query(
      `INSERT INTO bill_corrections (id, bill_id, type, changes, adjusted_amount, tax_adjustment, created_at, is_synced)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), FALSE)
       ON CONFLICT (id) DO UPDATE
       SET type = EXCLUDED.type,
           changes = EXCLUDED.changes,
           adjusted_amount = EXCLUDED.adjusted_amount,
           tax_adjustment = EXCLUDED.tax_adjustment
       RETURNING id`,
      [correctionId, billId, type, changes, adjustedAmount, taxAdjustment]
    );

    if (type === 'CANCEL') {
      const orderRes = await requestPool.query(
        `SELECT id, order_status, branch_id, customer_id, total_price
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [billId]
      );
      if (orderRes.rowCount === 0) {
        throw buildValidationError('Order not found.');
      }

      const itemsRes = await requestPool.query(
        `SELECT product_id, quantity, selling_price, discount_amount, gst_percent, batch_id, purchase_price_snapshot
         FROM order_items
         WHERE order_id = $1`,
        [billId]
      );

      const productIds = itemsRes.rows.map((row) => row.product_id);
      const quantities = itemsRes.rows.map((row) => Number(row.quantity || 0));
      if (productIds.length) {
        await requestPool.query(
          `UPDATE products p
           SET stock_quantity = p.stock_quantity + u.qty
           FROM (
             SELECT unnest($1::int[]) AS product_id, unnest($2::numeric[]) AS qty
           ) AS u
           WHERE p.id = u.product_id`,
          [productIds, quantities]
        );
      }

      const batchItems = itemsRes.rows.filter((row) => row.batch_id);
      if (batchItems.length) {
        const batchIds = batchItems.map((row) => row.batch_id);
        const batchQtys = batchItems.map((row) => Number(row.quantity || 0));
        await requestPool.query(
          `UPDATE batches b
           SET quantity_remaining = COALESCE(b.quantity_remaining, 0) + u.qty,
               quantity = COALESCE(b.quantity, 0) + u.qty
           FROM (
             SELECT unnest($1::uuid[]) AS batch_id, unnest($2::numeric[]) AS qty
           ) AS u
           WHERE b.id = u.batch_id`,
          [batchIds, batchQtys]
        );
      }

      const totals = itemsRes.rows.reduce(
        (acc, row) => {
          const qty = Number(row.quantity || 0);
          const lineTotal = (Number(row.selling_price || 0) * qty) - Number(row.discount_amount || 0);
          const gst = (lineTotal * Number(row.gst_percent || 0)) / 100;
          acc.amount += lineTotal;
          acc.tax += gst;
          return acc;
        },
        { amount: 0, tax: 0 }
      );

      await requestPool.query(
        `UPDATE orders
         SET order_status = 'cancelled'
         WHERE id = $1`,
        [billId]
      );

      await requestPool.query(
        `INSERT INTO gst_ledger (id, bill_id, type, taxable_amount, cgst, sgst, igst, total_tax, date, is_synced)
         VALUES (gen_random_uuid(), $1, 'ADJUSTMENT', $2, $3, $4, 0, $5, CURRENT_DATE, FALSE)`,
        [billId, -totals.amount, -totals.tax / 2, -totals.tax / 2, -totals.tax]
      );

      await requestPool.query(
        `INSERT INTO transactions (order_id, total_price, profit, payment_mode, transaction_type, reference_id, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id)
         VALUES ($1, $2, 0, 'cancel', 'refund', NULL, NOW(), $2, 'customer', $3, 'out', 'adjustment', 'Order cancelled', $4)`,
        [billId, -Math.abs(Number(totals.amount || 0)), orderRes.rows[0].customer_id || null, orderRes.rows[0].branch_id || null]
      );
    }

    return res.status(201).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const listCorrections = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const result = await requestPool.query(
      `SELECT c.id AS "correctionId",
              c.bill_id AS "billId",
              c.type,
              c.changes,
              c.adjusted_amount AS "adjustedAmount",
              c.tax_adjustment AS "taxAdjustment",
              c.created_at AS "createdAt"
       FROM bill_corrections c
       JOIN orders o ON o.id = c.bill_id
       WHERE ($1::uuid IS NULL OR o.branch_id = $1)
       ORDER BY c.created_at DESC`,
      [branchId]
    );
    return res.status(200).json({ success: true, corrections: result.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { createCorrection, listCorrections };
