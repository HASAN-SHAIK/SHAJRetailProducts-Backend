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

const createPurchase = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    throw buildValidationError('items must be a non-empty array.');
  }

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');
    const branchId = await resolveBranchId(client, payload.branch_id);

    const created = [];
    for (const item of items) {
      const productId = normalizeNumber(item.product_id);
      if (!Number.isFinite(productId)) {
        throw buildValidationError('product_id is required.');
      }
      const quantity = normalizeNumber(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw buildValidationError('quantity must be > 0.');
      }
      const purchasePrice = normalizeNumber(item.purchase_price);
      const sellingPrice = normalizeNumber(item.selling_price);
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        throw buildValidationError('purchase_price must be >= 0.');
      }
      if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
        throw buildValidationError('selling_price must be >= 0.');
      }
      const batchNumber = item.batch_number ? String(item.batch_number).trim() : null;
      const expiryDate = item.expiry_date ? new Date(item.expiry_date) : null;
      if (expiryDate && Number.isNaN(expiryDate.getTime())) {
        throw buildValidationError('expiry_date is invalid.');
      }

      const productRes = await client.query(
        'SELECT id FROM products WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
        [productId]
      );
      if (productRes.rowCount === 0) {
        throw buildValidationError(`Product ID ${productId} not found or deleted.`);
      }

      const batchRes = await client.query(
        `INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity, created_at`,
        [productId, branchId, batchNumber, expiryDate, purchasePrice, sellingPrice, quantity]
      );

      await client.query(
        `UPDATE products
         SET stock_quantity = COALESCE(stock_quantity, 0) + $1,
             purchase_price = $2,
             purchase_price = $2,
             selling_price = $3
         WHERE id = $4`,
        [quantity, purchasePrice, sellingPrice, productId]
      );

      created.push(batchRes.rows[0]);
    }

    await client.query('COMMIT');
    return created;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { createPurchase };

