const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const { insertLedgerEntries } = require('./ledgerPostingService');

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
};

const createPurchaseReturn = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw buildValidationError('items must be a non-empty array.');
  }
  const purchaseId = normalizeNumber(payload.purchase_id);
  const supplierId = normalizeNumber(payload.supplier_id);
  if (!Number.isFinite(purchaseId)) {
    throw buildValidationError('purchase_id is required.');
  }
  if (!Number.isFinite(supplierId)) {
    throw buildValidationError('supplier_id is required.');
  }

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');

    const purchaseRes = await client.query(
      `SELECT id, branch_id, supplier_id
       FROM orders
       WHERE id = $1 AND transaction_type = 'purchase'`,
      [purchaseId]
    );
    if (purchaseRes.rowCount === 0) {
      throw buildValidationError('purchase_id is invalid.');
    }
    const purchase = purchaseRes.rows[0];
    const branchId = payload.branch_id || purchase.branch_id || null;
    if (purchase.supplier_id && Number(purchase.supplier_id) !== Number(supplierId)) {
      throw buildValidationError('supplier_id does not match purchase.');
    }

    const supplierRes = await client.query(
      'SELECT id FROM suppliers WHERE id = $1',
      [supplierId]
    );
    if (supplierRes.rowCount === 0) {
      throw buildValidationError('supplier_id is invalid.');
    }

    const returnRes = await client.query(
      `INSERT INTO purchase_returns (purchase_id, supplier_id, total_amount, reason)
       VALUES ($1, $2, 0, $3)
       RETURNING id`,
      [purchaseId, supplierId, payload.reason || null]
    );
    const returnId = returnRes.rows[0].id;

    let totalAmount = 0;
    for (const item of items) {
      const batchId = item.batch_id || item.batchId;
      const productId = normalizeNumber(item.product_id || item.productId);
      const qty = normalizeNumber(item.quantity);
      if (!batchId) {
        throw buildValidationError('batch_id is required.');
      }
      if (!Number.isFinite(productId)) {
        throw buildValidationError('product_id is required.');
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        throw buildValidationError('quantity must be > 0.');
      }

      const batchRes = await client.query(
        `SELECT id, product_id, branch_id, purchase_price, quantity, quantity_remaining, purchase_order_id
         FROM batches
         WHERE id = $1
         FOR UPDATE`,
        [batchId]
      );
      if (batchRes.rowCount === 0) {
        throw buildValidationError('batch_id is invalid.');
      }
      const batch = batchRes.rows[0];
      const available = Number(batch.quantity_remaining ?? batch.quantity ?? 0);
      if (Number(batch.product_id) !== Number(productId)) {
        throw buildValidationError('batch does not match product_id.');
      }
      if (batch.purchase_order_id && Number(batch.purchase_order_id) !== Number(purchaseId)) {
        throw buildValidationError('batch does not belong to selected purchase.');
      }
      if (batch.branch_id && branchId && batch.branch_id !== branchId) {
        throw buildValidationError('batch does not belong to selected branch.');
      }
      if (available < qty) {
        throw buildValidationError('Return quantity exceeds available batch quantity.');
      }

      const newRemaining = available - qty;
      await client.query(
        'UPDATE batches SET quantity_remaining = $1 WHERE id = $2',
        [newRemaining, batchId]
      );

      const productRes = await client.query(
        'SELECT stock_quantity FROM products WHERE id = $1 FOR UPDATE',
        [productId]
      );
      if (productRes.rowCount === 0) {
        throw buildValidationError('product_id is invalid.');
      }
      const currentStock = Number(productRes.rows[0].stock_quantity || 0);
      if (currentStock < qty) {
        throw buildValidationError('Return quantity exceeds available stock.');
      }
      await client.query(
        `UPDATE products
         SET stock_quantity = $1
         WHERE id = $2`,
        [currentStock - qty, productId]
      );

      const amount = Number(batch.purchase_price || 0) * qty;
      totalAmount += amount;

      await client.query(
        `INSERT INTO purchase_return_items (purchase_return_id, batch_id, product_id, quantity, amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [returnId, batchId, productId, qty, amount]
      );
    }

    await client.query(
      `UPDATE purchase_returns
       SET total_amount = $1
       WHERE id = $2`,
      [totalAmount, returnId]
    );

    await client.query(
      `INSERT INTO transactions (order_id, total_price, profit, payment_mode, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id)
       VALUES ($1, $2, 0, 'cash', NOW(), $2, 'supplier', $3, 'in', 'refund', $4, $5)`,
      [purchaseId, totalAmount, supplierId, payload.reason || null, branchId || null]
    );
    await insertLedgerEntries({
      client,
      lines: [
        { ledger: 'Accounts Payable', debit: totalAmount, credit: 0 },
        { ledger: 'Purchase', debit: 0, credit: totalAmount },
      ],
      transactionId: null,
      referenceId: returnId,
      referenceType: 'return',
      description: `Purchase return #${returnId}`,
      date: new Date().toISOString(),
      branchId: branchId || null,
      clientTxnId: null,
      syncStatus: 'SYNCED',
      partyType: 'supplier',
      partyId: supplierId,
    });

    await client.query('COMMIT');
    return { id: returnId, total_amount: totalAmount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const listPurchaseReturns = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const params = [];
  const conditions = [];
  let idx = 1;

  if (query.branch_id) {
    conditions.push(`o.branch_id = $${idx}`);
    params.push(query.branch_id);
    idx += 1;
  }
  if (query.supplier_id) {
    conditions.push(`pr.supplier_id = $${idx}`);
    params.push(query.supplier_id);
    idx += 1;
  }
  if (query.purchase_id) {
    conditions.push(`pr.purchase_id = $${idx}`);
    params.push(query.purchase_id);
    idx += 1;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Number.isFinite(Number(query.limit)) ? Math.min(Number(query.limit), 1000) : 200;

  const result = await requestPool.query(
    `SELECT pr.id,
            pr.purchase_id,
            pr.total_amount,
            pr.reason,
            pr.created_at,
            pr.supplier_id,
            s.name AS supplier_name
     FROM purchase_returns pr
     LEFT JOIN orders o ON o.id = pr.purchase_id
     LEFT JOIN suppliers s ON s.id = pr.supplier_id
     ${whereClause}
     ORDER BY pr.created_at DESC
     LIMIT $${idx}`,
    [...params, limit]
  );
  return result.rows;
};

module.exports = {
  createPurchaseReturn,
  listPurchaseReturns
};
