const crypto = require('crypto');
const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const createReturn = async (req, res) => {
  try {
    const orderController = require('./orderController');
    return await orderController.processOrderReturn(req, res);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const createUnreferencedReturn = async (req, res) => {
  const requestPool = getRequestPool(req);
  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');

    const payload = req.body || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      throw new Error('At least one return item is required for walk-in return.');
    }

    const branchId = resolveBranchIdFromRequest(req) || payload.branchId || payload.branch_id || null;
    const customerId = payload.customerId || payload.customer_id || null;
    const customerName = payload.customerName || payload.customer_name || 'Walk-in Customer';
    const reason = payload.reason || 'Walk-in / unreferenced return';
    const refundMode = String(payload.refundMode || payload.refund_mode || 'cash').toLowerCase();
    const managerApprovedBy = payload.managerApprovedBy || payload.manager_approved_by || req.user?.username || 'Store Manager';
    const returnUuid = payload.returnUuid || payload.return_uuid || crypto.randomUUID();
    const createdBy = req.user?.id || null;

    let refundTotal = 0;
    let taxReversedTotal = 0;
    const processedItems = [];

    for (const item of items) {
      const productId = Number(item.productId || item.product_id);
      if (!Number.isFinite(productId) || productId <= 0) {
        throw new Error('Invalid product ID in return item.');
      }

      const quantity = Math.max(0, Number(item.quantity || item.qty || 0));
      if (quantity <= 0) {
        throw new Error(`Invalid return quantity for product ${productId}.`);
      }

      // Query product details from database
      const prodRes = await client.query(
        `SELECT id, name, price, gst_percent, is_weight_based FROM products WHERE id = $1`,
        [productId]
      );
      if (prodRes.rowCount === 0) {
        throw new Error(`Product ${productId} not found.`);
      }
      const product = prodRes.rows[0];

      // Manager override price or default to product price
      const overridePrice = item.unitPrice !== undefined ? Number(item.unitPrice) : Number(product.price || 0);
      if (!Number.isFinite(overridePrice) || overridePrice < 0) {
        throw new Error(`Invalid return unit price for product ${product.name}.`);
      }

      const lineTotal = Math.round(quantity * overridePrice * 100) / 100;
      refundTotal += lineTotal;

      const gstPercent = Number(product.gst_percent || 0);
      let gstAmount = 0;
      if (gstPercent > 0) {
        const taxable = lineTotal / (1 + gstPercent / 100);
        gstAmount = Math.round((lineTotal - taxable) * 100) / 100;
        taxReversedTotal += gstAmount;
      }

      const condition = String(item.condition || item.itemCondition || 'good').toLowerCase();
      const batchId = item.batchId || item.batch_id || null;

      // Restock sellable inventory if condition is 'good'
      if (condition === 'good') {
        await client.query(
          `UPDATE products
           SET stock_quantity = COALESCE(stock_quantity, 0) + $1,
               updated_at = NOW()
           WHERE id = $2`,
          [quantity, productId]
        );

        if (batchId) {
          await client.query(
            `UPDATE batches
             SET stock = COALESCE(stock, 0) + $1
             WHERE id = $2`,
            [quantity, batchId]
          );
        }
      }

      processedItems.push({
        productId,
        productName: product.name,
        batchId,
        quantity,
        unitPrice: overridePrice,
        lineTotal,
        gstAmount,
        condition,
      });
    }

    refundTotal = Math.round(refundTotal * 100) / 100;
    taxReversedTotal = Math.round(taxReversedTotal * 100) / 100;

    // Insert order_returns row for unreferenced return
    const returnInsertRes = await client.query(
      `INSERT INTO order_returns (
        order_id,
        customer_id,
        refund_total,
        refund_mode,
        reason,
        created_by,
        return_uuid,
        tax_reversed,
        is_unreferenced,
        branch_id,
        manager_approved_by,
        customer_name,
        created_at
      ) VALUES (
        NULL,
        $1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, $10, NOW()
      ) RETURNING id, return_uuid, refund_total, refund_mode, reason, created_at, is_unreferenced, manager_approved_by, customer_name`,
      [
        customerId,
        refundTotal,
        refundMode,
        reason,
        createdBy,
        returnUuid,
        taxReversedTotal,
        branchId,
        managerApprovedBy,
        customerName,
      ]
    );

    const returnRecord = returnInsertRes.rows[0];
    const returnDbId = returnRecord.id;

    // Insert order_return_items
    for (const pItem of processedItems) {
      await client.query(
        `INSERT INTO order_return_items (
          return_id,
          product_id,
          batch_id,
          quantity,
          unit_price,
          line_total,
          gst_amount,
          item_condition,
          manager_override_price
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          returnDbId,
          pItem.productId,
          pItem.batchId,
          pItem.quantity,
          pItem.unitPrice,
          pItem.lineTotal,
          pItem.gstAmount,
          pItem.condition,
          pItem.unitPrice,
        ]
      );
    }

    // Customer store credit adjustment
    if (refundMode === 'store_credit' && customerId) {
      try {
        await client.query(
          `UPDATE customers
           SET credit_balance = COALESCE(credit_balance, 0) + $1,
               updated_at = NOW()
           WHERE id = $2`,
          [refundTotal, customerId]
        );
      } catch (e) {
        // optional ledger hook
      }
    }

    // Cash drawer transaction record
    if (refundMode === 'cash') {
      try {
        await client.query(
          `INSERT INTO accounting_transactions (
            branch_id, transaction_type, category, amount, description, reference_id, created_by, created_at
          ) VALUES ($1, 'DEBIT', 'WALK_IN_REFUND', $2, $3, $4, $5, NOW())`,
          [
            branchId,
            refundTotal,
            `Unreferenced cash refund: ${reason} (Return #${returnUuid.slice(0, 8)})`,
            returnUuid,
            createdBy,
          ]
        );
      } catch (e) {
        // non-blocking
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Unreferenced walk-in return processed successfully',
      return: {
        returnId: returnRecord.return_uuid,
        returnDbId: returnRecord.id,
        isUnreferenced: true,
        refundTotal: Number(returnRecord.refund_total),
        refundMode: returnRecord.refund_mode,
        reason: returnRecord.reason,
        managerApprovedBy: returnRecord.manager_approved_by,
        customerName: returnRecord.customer_name,
        date: returnRecord.created_at,
        items: processedItems,
        taxReversed: taxReversedTotal,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const status = error.status || 400;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to process unreferenced return',
    });
  } finally {
    client.release();
  }
};

const listReturns = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const result = await requestPool.query(
      `SELECT r.return_uuid AS "returnId",
              r.order_id AS "originalBillId",
              r.refund_total AS "refundAmount",
              r.tax_reversed AS "taxReversed",
              r.created_at AS "date",
              r.reason,
              r.updated_at AS "updatedAt",
              r.refund_mode AS "refundMode",
              r.id AS "returnDbId",
              COALESCE(r.is_unreferenced, FALSE) AS "isUnreferenced",
              r.customer_name AS "customerName",
              r.manager_approved_by AS "managerApprovedBy"
       FROM order_returns r
       LEFT JOIN orders o ON o.id = r.order_id
       WHERE ($1::uuid IS NULL OR o.branch_id = $1 OR r.branch_id = $1)
       ORDER BY r.created_at DESC`,
      [branchId]
    );
    return res.status(200).json({ success: true, returns: result.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getReturnItems = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const returnId = req.params.id;
    const result = await requestPool.query(
      `SELECT r.return_uuid AS "returnId",
              r.order_id AS "originalBillId",
              r.refund_total AS "refundAmount",
              r.tax_reversed AS "taxReversed",
              r.created_at AS "date",
              r.reason,
              COALESCE(r.is_unreferenced, FALSE) AS "isUnreferenced",
              r.customer_name AS "customerName",
              r.manager_approved_by AS "managerApprovedBy",
              r.refund_mode AS "refundMode",
              ori.product_id AS "productId",
              COALESCE(p.name, 'Product #' || ori.product_id) AS "productName",
              ori.batch_id AS "batchId",
              ori.quantity,
              ori.unit_price AS "unitPrice",
              ori.line_total AS "lineTotal",
              ori.gst_amount AS "gstAmount",
              COALESCE(ori.item_condition, 'good') AS "itemCondition",
              ori.manager_override_price AS "managerOverridePrice"
       FROM order_returns r
       JOIN order_return_items ori ON ori.return_id = r.id
       LEFT JOIN products p ON p.id = ori.product_id
       WHERE r.return_uuid = $1 OR r.id::text = $1`,
      [returnId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'Return not found' });
    }
    const header = result.rows[0];
    const items = result.rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      batchId: row.batchId,
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unitPrice || 0),
      lineTotal: Number(row.lineTotal || 0),
      gstAmount: Number(row.gstAmount || 0),
      itemCondition: row.itemCondition,
      managerOverridePrice: row.managerOverridePrice ? Number(row.managerOverridePrice) : null,
    }));
    return res.status(200).json({
      success: true,
      return: {
        returnId: header.returnId,
        originalBillId: header.originalBillId,
        isUnreferenced: header.isUnreferenced,
        customerName: header.customerName,
        managerApprovedBy: header.managerApprovedBy,
        refundMode: header.refundMode,
        refundAmount: header.refundAmount,
        taxReversed: header.taxReversed,
        date: header.date,
        reason: header.reason,
        items,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = {
  createReturn,
  createUnreferencedReturn,
  listReturns,
  getReturnItems,
};
