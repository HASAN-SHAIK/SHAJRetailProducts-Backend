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
              r.id AS "returnDbId"
       FROM order_returns r
       JOIN orders o ON o.id = r.order_id
       WHERE ($1::uuid IS NULL OR o.branch_id = $1)
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
              ori.product_id AS "productId",
              ori.batch_id AS "batchId",
              ori.quantity,
              ori.unit_price AS "unitPrice",
              ori.line_total AS "lineTotal",
              ori.gst_amount AS "gstAmount"
       FROM order_returns r
       JOIN order_return_items ori ON ori.return_id = r.id
       WHERE r.return_uuid = $1`,
      [returnId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'Return not found' });
    }
    const header = result.rows[0];
    const items = result.rows.map((row) => ({
      productId: row.productId,
      batchId: row.batchId,
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unitPrice || 0),
      lineTotal: Number(row.lineTotal || 0),
      gstAmount: Number(row.gstAmount || 0),
    }));
    return res.status(200).json({
      success: true,
      return: {
        returnId: header.returnId,
        originalBillId: header.originalBillId,
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

module.exports = { createReturn, listReturns, getReturnItems };
