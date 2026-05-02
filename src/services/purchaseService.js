const pool = require('../db');
const { setStockAuditContext } = require('./stockAuditService');
const { insertLedgerEntries, resolveCashBankLedgerName } = require('./ledgerPostingService');
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

const toCompactDate = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const buildAutoBatchNumber = () =>
  `${toCompactDate()}-${Math.floor(100000 + Math.random() * 900000)}`;

const ensureUniqueBatchNumber = async (client, productId, branchId, requestedBatchNumber) => {
  let candidate = String(requestedBatchNumber || '').trim();
  if (!candidate) return null;
  let suffix = 1;
  while (true) {
    const duplicateRes = await client.query(
      `SELECT id
       FROM batches
       WHERE product_id = $1
         AND is_deleted = FALSE
         AND batch_number = $2
         AND (
           ($3::uuid IS NULL AND branch_id IS NULL) OR
           branch_id = $3::uuid
         )
       LIMIT 1`,
      [productId, candidate, branchId || null]
    );
    if (duplicateRes.rowCount === 0) {
      return candidate;
    }
    candidate = `${requestedBatchNumber}-${suffix}`;
    suffix += 1;
  }
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

const normalizeOptionalText = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const normalizePaymentMode = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  if (!mode) return 'credit';
  if (mode === 'upi') return 'online';
  if (mode === 'bank') return 'bank';
  if (mode === 'cash' || mode === 'online' || mode === 'credit') return mode;
  return 'credit';
};

const resolveDiscountAmount = (item, lineBase = 0) => {
  const explicitAmount = normalizeNumber(item.discount_amount);
  if (Number.isFinite(explicitAmount) && explicitAmount >= 0) {
    return explicitAmount;
  }
  const rawValue = item.discount_value ?? item.discount;
  const parsed = normalizeNumber(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  const type = String(item.discount_type || '').trim().toLowerCase();
  if (type === 'percent' || type === 'percentage') {
    const pct = Math.min(parsed, 100);
    return (Number(lineBase || 0) * pct) / 100;
  }
  return parsed;
};

const calculateTotal = (items, gstMode) => {
  return items.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const price = Number(item.purchase_price || 0);
    const base = qty * price;
    const gstPercent = Number(item.gst_percent || item.gst_percent === 0 ? item.gst_percent : item.gstPercent);
    const gst = Number.isFinite(gstPercent) ? (base * gstPercent) / 100 : 0;
    const line = base + gst;
    const discount = resolveDiscountAmount(item, line);
    return sum + Math.max(line - discount, 0);
  }, 0);
};

const calculatePurchaseBreakup = (items = []) => {
  let taxableTotal = 0;
  let gstTotal = 0;
  let grandTotal = 0;
  for (const item of items) {
    const qty = Number(item.quantity || 0);
    const price = Number(item.purchase_price || 0);
    const base = qty * price;
    const gstPercent = Number(item.gst_percent || item.gstPercent || 0);
    const gst = Number.isFinite(gstPercent) ? (base * gstPercent) / 100 : 0;
    const line = base + gst;
    const discount = resolveDiscountAmount(item, line);
    const netLine = Math.max(line - discount, 0);
    const ratio = line > 0 ? (netLine / line) : 0;
    taxableTotal += Math.max(base * ratio, 0);
    gstTotal += Math.max(gst * ratio, 0);
    grandTotal += netLine;
  }
  return {
    taxableTotal,
    gstTotal,
    grandTotal,
  };
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
    await setStockAuditContext(client, req, { reason: 'purchase', source: 'purchase', reference: payload.invoice_number || null });
    const branchId = await resolveBranchId(client, payload.branch_id);
    await ensureSupplier(client, supplierId, branchId);

    const gstMode = resolveGstMode(req);
    const breakup = calculatePurchaseBreakup(items);
    const totalPrice = breakup.grandTotal || calculateTotal(items, gstMode);
    const paymentMode = normalizePaymentMode(payload.payment_mode || payload.paymentMode || 'credit');
    const invoiceNumber = normalizeOptionalText(payload.invoice_number || payload.invoiceNumber || null);
    const requestedPaidAmount = normalizeNumber(payload.paid_amount ?? payload.paidAmount);
    let paidAmount;
    if (paymentMode !== 'credit') {
      if (Number.isFinite(requestedPaidAmount) && requestedPaidAmount < totalPrice) {
        throw buildValidationError('For cash/online/bank purchases, full payment is required. Use credit for pending payable.');
      }
      paidAmount = totalPrice;
    } else {
      const normalizedPaidAmount = Number.isFinite(requestedPaidAmount)
        ? Math.max(requestedPaidAmount, 0)
        : 0;
      paidAmount = Math.min(normalizedPaidAmount, totalPrice);
    }
    const payableOutstanding = Math.max(totalPrice - paidAmount, 0);
    const purchaseStatus = payableOutstanding > 0 ? 'pending' : 'completed';

    const orderRes = await client.query(
      `INSERT INTO orders (supplier_id, branch_id, total_price, total_paid, order_status, payment_mode, transaction_type, gst_mode, is_gst_enabled, invoice_number)
       VALUES ($1, $2, $3, $4, $5, $6, 'purchase', $7, TRUE, $8)
       RETURNING id, created_at`,
      [supplierId, branchId, totalPrice, paidAmount, purchaseStatus, paymentMode, gstMode, invoiceNumber]
    );
    const orderId = orderRes.rows[0].id;

    await client.query(
      `INSERT INTO transactions (order_id, total_price, profit, payment_mode, created_at, amount, party_type, party_id, direction, txn_type, notes, branch_id)
       VALUES ($1, $2, 0, $3, NOW(), $2, 'supplier', $4, 'out', 'purchase', NULL, $5)`,
      [orderId, totalPrice, paymentMode, supplierId, branchId]
    );
    const txnRes = await client.query(
      `SELECT id
       FROM transactions
       WHERE order_id = $1
         AND party_type = 'supplier'
         AND txn_type = 'purchase'
       ORDER BY id DESC
       LIMIT 1`,
      [orderId]
    );
    const purchaseTxnId = txnRes.rows[0]?.id || null;

    const lines = [
      { ledger: 'Purchase', debit: Number(breakup.taxableTotal || totalPrice), credit: 0 },
      { ledger: 'Accounts Payable', debit: 0, credit: Number(totalPrice || 0) },
    ];
    const gstComponent = Number(breakup.gstTotal || 0);
    if (gstComponent > 0) {
      lines.splice(1, 0, { ledger: 'Input IGST', debit: gstComponent, credit: 0 });
      lines[0].debit = Math.max(Number(totalPrice || 0) - gstComponent, 0);
    }
    await insertLedgerEntries({
      client,
      lines,
      transactionId: purchaseTxnId,
      referenceId: orderId,
      referenceType: 'order',
      description: `Purchase order #${orderId}`,
      date: orderRes.rows[0].created_at,
      branchId,
      clientTxnId: null,
      syncStatus: 'SYNCED',
      partyType: 'supplier',
      partyId: supplierId,
    });
    if (paymentMode !== 'credit' && Number(totalPrice || 0) > 0) {
      await insertLedgerEntries({
        client,
        lines: [
          { ledger: 'Accounts Payable', debit: Number(totalPrice || 0), credit: 0 },
          { ledger: resolveCashBankLedgerName(paymentMode), debit: 0, credit: Number(totalPrice || 0) },
        ],
        transactionId: purchaseTxnId,
        referenceId: orderId,
        referenceType: 'payment',
        description: `Auto settlement for purchase order #${orderId}`,
        date: orderRes.rows[0].created_at,
        branchId,
        clientTxnId: null,
        syncStatus: 'SYNCED',
        partyType: 'supplier',
        partyId: supplierId,
      });
    }

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
      const base = quantity * purchasePrice;
      const discount = resolveDiscountAmount(item, base);
      const category = item.category ? String(item.category).trim() : null;
      const company = item.company ? String(item.company).trim() : null;
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        throw buildValidationError('purchase_price must be >= 0.');
      }
      if (item.selling_price !== undefined && (!Number.isFinite(sellingPrice) || sellingPrice < 0)) {
        throw buildValidationError('selling_price must be >= 0.');
      }
      if (!Number.isFinite(discount) || discount < 0) {
        throw buildValidationError('discount must be >= 0.');
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
        `SELECT id, stock_quantity, purchase_price, selling_price
         FROM products
         WHERE id = $1 AND is_deleted = FALSE
         FOR UPDATE`,
        [productId]
      );
      if (productRes.rowCount === 0) {
        throw buildValidationError(`Product ID ${productId} not found or deleted.`);
      }

      const batchNumberInput = item.batch_number ? String(item.batch_number).trim() : '';
      let createdBatch;
      if (batchNumberInput) {
        const existingBatchRes = await client.query(
          `SELECT id
           FROM batches
           WHERE product_id = $1
             AND is_deleted = FALSE
             AND batch_number = $2
             AND (
               ($3::uuid IS NULL AND branch_id IS NULL) OR
               branch_id = $3::uuid
             )
           LIMIT 1`,
          [productId, batchNumberInput, branchId || null]
        );
        if (existingBatchRes.rowCount > 0) {
          const updateBatchRes = await client.query(
            `UPDATE batches
             SET quantity = COALESCE(quantity, 0) + $1,
                 quantity_remaining = COALESCE(quantity_remaining, 0) + $1,
                 purchase_price = $2,
                 selling_price = COALESCE($3, selling_price),
                 mrp = COALESCE($4, mrp),
                 expiry_date = COALESCE($5, expiry_date),
                 purchase_order_id = COALESCE($6, purchase_order_id),
                 updated_at = NOW()
             WHERE id = $7
             RETURNING id, product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, mrp, quantity, quantity_remaining, created_at`,
            [
              quantity,
              purchasePrice,
              Number.isFinite(sellingPrice) ? sellingPrice : null,
              Number.isFinite(mrp) ? mrp : null,
              expiryDate,
              orderId,
              existingBatchRes.rows[0].id
            ]
          );
          createdBatch = updateBatchRes.rows[0];
        }
      }
      if (!createdBatch) {
        const generatedBatch = buildAutoBatchNumber(productId, index);
        const resolvedBatchNumber = await ensureUniqueBatchNumber(
          client,
          productId,
          branchId,
          batchNumberInput || generatedBatch
        );
        const batchRes = await client.query(
          `INSERT INTO batches (
              product_id,
              branch_id,
              batch_number,
              expiry_date,
              purchase_price,
              selling_price,
              mrp,
              quantity,
              quantity_remaining,
              purchase_order_id
            )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
           RETURNING id, product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, mrp, quantity, quantity_remaining, created_at`,
          [
            productId,
            branchId,
            resolvedBatchNumber,
            expiryDate,
            purchasePrice,
            Number.isFinite(sellingPrice) ? sellingPrice : null,
            Number.isFinite(mrp) ? mrp : null,
            quantity,
            orderId
          ]
        );
        createdBatch = batchRes.rows[0];
      }

      await client.query(
        `INSERT INTO order_items (order_id, product_id, batch_id, quantity, selling_price, purchase_price_snapshot, gst_percent, discount_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          orderId,
          productId,
          createdBatch.id,
          quantity,
          Number.isFinite(sellingPrice) ? sellingPrice : null,
          purchasePrice,
          Number.isFinite(gstPercent) ? gstPercent : 0,
          Number.isFinite(discount) ? discount : 0
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

      createdBatches.push(createdBatch);
    }

    await client.query('COMMIT');
    return {
      order_id: orderId,
      total_price: totalPrice,
      total_paid: paidAmount,
      payable_outstanding: payableOutstanding,
      batches: createdBatches
    };
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
            COALESCE(o.total_paid, 0) AS total_paid,
            GREATEST(COALESCE(o.total_price, 0) - COALESCE(o.total_paid, 0), 0) AS payable_outstanding,
            o.order_status,
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
  const numericPurchaseId = Number(purchaseId);
  if (!Number.isFinite(numericPurchaseId)) {
    throw buildValidationError('purchase id must be a number.');
  }
  const orderRes = await requestPool.query(
    `SELECT o.*,
            GREATEST(COALESCE(o.total_price, 0) - COALESCE(o.total_paid, 0), 0) AS payable_outstanding,
            s.name AS supplier_name,
            s.mobile AS supplier_mobile,
            s.gst_number AS supplier_gst
     FROM orders o
     LEFT JOIN suppliers s ON s.id = o.supplier_id
     WHERE o.id = $1 AND o.transaction_type = 'purchase'`,
    [numericPurchaseId]
  );
  if (orderRes.rowCount === 0) return null;
  const itemsRes = await requestPool.query(
    `SELECT oi.id,
            oi.product_id,
            oi.batch_id,
            b.batch_number,
            p.name AS product_name,
            oi.quantity,
            oi.purchase_price_snapshot,
            oi.selling_price,
            oi.gst_percent
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN batches b ON b.id = oi.batch_id
     WHERE oi.order_id = $1`,
    [numericPurchaseId]
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
    [numericPurchaseId]
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
