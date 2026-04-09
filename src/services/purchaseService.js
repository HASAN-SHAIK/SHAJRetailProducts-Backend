const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;

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

const normalizeDateOnly = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const ensureBranchExists = async (client, branchId) => {
  const res = await client.query('SELECT id FROM branches WHERE id = $1', [branchId]);
  if (res.rowCount === 0) {
    throw buildValidationError('branch_id is invalid.');
  }
};

const resolveBranchId = async (client, branchIdInput) => {
  if (isUuid(branchIdInput)) {
    await ensureBranchExists(client, branchIdInput);
    return branchIdInput;
  }

  const branchesRes = await client.query(
    'SELECT id FROM branches ORDER BY created_at ASC LIMIT 2'
  );
  if (branchesRes.rowCount === 1) {
    return branchesRes.rows[0].id;
  }
  if (branchesRes.rowCount === 0) {
    throw buildValidationError('No branches found.');
  }
  throw buildValidationError('branch_id is required.');
};

const resolveGstMode = (req) => {
  const raw = req?.tenant?.gst_mode || req?.tenant?.gstMode || null;
  const mode = String(raw || 'INCLUSIVE').trim().toUpperCase();
  return mode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE';
};

const calculateTotal = (items, gstMode) => {
  return items.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const price = Number(item.purchase_price || 0);
    const base = qty * price;
    const gstPercent = Number(item.gst_percent || item.gst_percent === 0 ? item.gst_percent : item.gstPercent);
    const gst = Number.isFinite(gstPercent) ? (base * gstPercent) / 100 : 0;
    return sum + (gstMode === 'EXCLUSIVE' ? base + gst : base);
  }, 0);
};

const ensureSupplier = async (client, supplierId, branchId) => {
  const res = await client.query(
    'SELECT id, branch_id FROM suppliers WHERE id = $1',
    [supplierId]
  );
  if (res.rowCount === 0) {
    throw buildValidationError('supplier_id is invalid.');
  }
  const supplier = res.rows[0];
  if (supplier.branch_id && branchId && supplier.branch_id !== branchId) {
    throw buildValidationError('supplier_id does not belong to selected branch.');
  }
  return supplier;
};

const createPurchase = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    throw buildValidationError('items must be a non-empty array.');
  }
  const supplierId = normalizeNumber(payload.supplier_id);
  if (!Number.isFinite(supplierId)) {
    throw buildValidationError('supplier_id is required.');
  }

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');
    const branchId = await resolveBranchId(client, payload.branch_id);
    await ensureSupplier(client, supplierId, branchId);

    const gstMode = resolveGstMode(req);
    const totalPrice = calculateTotal(items, gstMode);
    const paymentMode = payload.payment_mode || payload.paymentMode || null;
    const invoiceNumber = payload.invoice_number || payload.invoiceNumber || null;

    const orderRes = await client.query(
      `INSERT INTO orders (supplier_id, branch_id, total_price, payment_mode, transaction_type, gst_mode, is_gst_enabled, invoice_number)
       VALUES ($1, $2, $3, $4, 'purchase', $5, TRUE, $6)
       RETURNING id, created_at`,
      [supplierId, branchId, totalPrice, paymentMode, gstMode, invoiceNumber]
    );
    const orderId = orderRes.rows[0].id;

    await client.query(
      `INSERT INTO transactions (order_id, total_price, profit, payment_mode, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id)
       VALUES ($1, $2, 0, $3, NOW(), $2, 'supplier', $4, 'out', 'purchase', NULL, $5)`,
      [orderId, totalPrice, paymentMode, supplierId, branchId]
    );

    const createdBatches = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      let productId = normalizeNumber(item.product_id);
      const barcode = item.barcode ? String(item.barcode).trim() : '';
      const name = item.name ? String(item.name).trim() : '';
      const quantity = normalizeNumber(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw buildValidationError('quantity must be > 0.');
      }
      const purchasePrice = normalizeNumber(item.purchase_price);
      const sellingPrice = normalizeNumber(item.selling_price);
      const mrp = normalizeNumber(item.mrp);
      const category = item.category ? String(item.category).trim() : null;
      const company = item.company ? String(item.company).trim() : null;
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        throw buildValidationError('purchase_price must be >= 0.');
      }
      if (item.selling_price !== undefined && (!Number.isFinite(sellingPrice) || sellingPrice < 0)) {
        throw buildValidationError('selling_price must be >= 0.');
      }
      const gstPercent = normalizeNumber(item.gst_percent ?? item.gstPercent);
      const expiryDate = normalizeDateOnly(item.expiry_date || item.expiryDate);
      if (expiryDate === undefined) {
        throw buildValidationError('expiry_date is invalid.');
      }
      const today = normalizeDateOnly(new Date());
      if (expiryDate && today && expiryDate < today) {
        throw buildValidationError('Expiry date must be on or after batch date.');
      }

      if (!Number.isFinite(productId)) {
        if (barcode) {
          const byBarcode = await client.query(
            'SELECT id FROM products WHERE barcode = $1 AND is_deleted = FALSE LIMIT 1',
            [barcode]
          );
          if (byBarcode.rowCount > 0) {
            productId = byBarcode.rows[0].id;
          }
        }
      }
      if (!Number.isFinite(productId) && name) {
        const byName = await client.query(
          'SELECT id FROM products WHERE name ILIKE $1 AND is_deleted = FALSE ORDER BY id ASC LIMIT 1',
          [name]
        );
        if (byName.rowCount > 0) {
          productId = byName.rows[0].id;
        }
      }
      if (!Number.isFinite(productId)) {
        if (!name) {
          throw buildValidationError('product_id, barcode, or name is required.');
        }
        const resolvedSellingPrice = Number.isFinite(sellingPrice) ? sellingPrice : purchasePrice;
        const insertRes = await client.query(
          `INSERT INTO products (
              name,
              category,
              selling_price,
              mrp,
              purchase_price,
              hsn_code,
              gst_percentage,
              stock_quantity,
              company,
              barcode,
              branch_id
            )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10)
           RETURNING id`,
          [
            name,
            category || null,
            resolvedSellingPrice,
            Number.isFinite(mrp) ? mrp : null,
            purchasePrice,
            item.hsn_code || item.hsnCode || null,
            Number.isFinite(gstPercent) ? gstPercent : null,
            company || null,
            barcode || null,
            branchId
          ]
        );
        productId = insertRes.rows[0].id;
      }

      const productRes = await client.query(
        'SELECT id FROM products WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
        [productId]
      );
      if (productRes.rowCount === 0) {
        throw buildValidationError(`Product ID ${productId} not found or deleted.`);
      }

      const batchNumber = item.batch_number ? String(item.batch_number).trim() : `PO-${orderId}-${index + 1}`;
      const batchRes = await client.query(
        `INSERT INTO batches (
            product_id,
            branch_id,
            batch_number,
            expiry_date,
            purchase_price,
            selling_price,
            quantity,
            quantity_remaining,
            purchase_order_id
          )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
         RETURNING id, product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity, quantity_remaining, created_at`,
        [productId, branchId, batchNumber, expiryDate, purchasePrice, Number.isFinite(sellingPrice) ? sellingPrice : null, quantity, orderId]
      );

      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, selling_price, purchase_price_snapshot, gst_percent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          orderId,
          productId,
          quantity,
          Number.isFinite(sellingPrice) ? sellingPrice : null,
          purchasePrice,
          Number.isFinite(gstPercent) ? gstPercent : 0
        ]
      );

      await client.query(
        `UPDATE products
         SET stock_quantity = COALESCE(stock_quantity, 0) + $1,
             purchase_price = $2,
             selling_price = COALESCE($3, selling_price),
             mrp = COALESCE($4, mrp),
             category = COALESCE($5, category),
             company = COALESCE($6, company)
         WHERE id = $7`,
        [
          quantity,
          purchasePrice,
          Number.isFinite(sellingPrice) ? sellingPrice : null,
          Number.isFinite(mrp) ? mrp : null,
          category || null,
          company || null,
          productId
        ]
      );

      createdBatches.push(batchRes.rows[0]);
    }

    if (String(paymentMode || '').toLowerCase() === 'credit') {
      await client.query(
        `UPDATE suppliers
         SET current_balance = COALESCE(current_balance, 0) + $1
         WHERE id = $2`,
        [totalPrice, supplierId]
      );
    }

    await client.query('COMMIT');
    return { order_id: orderId, total_price: totalPrice, batches: createdBatches };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const listPurchases = async (req, query = {}) => {
  const requestPool = getRequestPool(req);
  const params = [];
  const conditions = ["o.transaction_type = 'purchase'"];
  let idx = 1;

  if (query.branch_id) {
    conditions.push(`o.branch_id = $${idx}`);
    params.push(query.branch_id);
    idx += 1;
  }
  if (query.supplier_id) {
    conditions.push(`o.supplier_id = $${idx}`);
    params.push(query.supplier_id);
    idx += 1;
  }
  if (query.start_date) {
    conditions.push(`o.created_at >= $${idx}`);
    params.push(query.start_date);
    idx += 1;
  }
  if (query.end_date) {
    conditions.push(`o.created_at <= $${idx}`);
    params.push(query.end_date);
    idx += 1;
  }

  const limit = Number.isFinite(Number(query.limit)) ? Math.min(Number(query.limit), 1000) : 200;
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await requestPool.query(
    `SELECT o.id,
            o.created_at,
            o.total_price,
            o.payment_mode,
            o.invoice_number,
            o.branch_id,
            o.supplier_id,
            s.name AS supplier_name
     FROM orders o
     LEFT JOIN suppliers s ON s.id = o.supplier_id
     ${whereClause}
     ORDER BY o.created_at DESC
     LIMIT $${idx}`,
    [...params, limit]
  );
  return result.rows;
};

const getPurchaseDetail = async (req, purchaseId) => {
  const requestPool = getRequestPool(req);
  const orderRes = await requestPool.query(
    `SELECT o.*,
            s.name AS supplier_name,
            s.mobile AS supplier_mobile,
            s.gst_number AS supplier_gst
     FROM orders o
     LEFT JOIN suppliers s ON s.id = o.supplier_id
     WHERE o.id = $1 AND o.transaction_type = 'purchase'`,
    [purchaseId]
  );
  if (orderRes.rowCount === 0) return null;
  const itemsRes = await requestPool.query(
    `SELECT oi.id,
            oi.product_id,
            p.name AS product_name,
            oi.quantity,
            oi.purchase_price_snapshot,
            oi.selling_price,
            oi.gst_percent
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`,
    [purchaseId]
  );
  const batchesRes = await requestPool.query(
    `SELECT id,
            product_id,
            branch_id,
            batch_number,
            expiry_date,
            purchase_price,
            selling_price,
            quantity,
            quantity_remaining,
            created_at
     FROM batches
     WHERE purchase_order_id = $1
     ORDER BY created_at ASC`,
    [purchaseId]
  );
  return {
    order: orderRes.rows[0],
    items: itemsRes.rows,
    batches: batchesRes.rows
  };
};

module.exports = {
  createPurchase,
  listPurchases,
  getPurchaseDetail
};
