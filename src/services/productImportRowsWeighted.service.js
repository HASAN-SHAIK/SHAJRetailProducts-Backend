const pool = require('../db');
const { resolveGstPercentage, upsertHsnGst } = require('./hsnGst.service');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;
const MAX_ERRORS = 50;

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return null;
  let trimmed = String(value).trim();
  if (!trimmed) return null;
  trimmed = trimmed.replace(/[% ,]/g, '');
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(excelEpoch.valueOf())) {
      return excelEpoch.toISOString().slice(0, 10);
    }
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString().slice(0, 10);
  }
  return raw;
};

const normalizeWeightFlag = (value, defaultValue = null) => {
  if (value === null || value === undefined || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = String(value).trim().toLowerCase();
  if (
    ['yes', 'y', 'true', '1', 'weight', 'weighted', 'weight based', 'weight-based', 'kg', 'kgs', 'gram', 'grams'].includes(raw)
  ) {
    return true;
  }
  if (
    ['no', 'n', 'false', '0', 'piece', 'pieces', 'piece based', 'piece-based', 'pcs', 'pc', 'unit', 'units'].includes(raw)
  ) {
    return false;
  }
  return defaultValue;
};

const importProductsFromRows = async (req, rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    const error = new Error('rows are required.');
    error.status = 400;
    throw error;
  }

  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req);
  const total = rows.length;
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  const barcodes = rows
    .map((row) => (row?.barcode ? String(row.barcode).trim() : null))
    .filter((value) => value);

  const existingSet = new Set();
  if (barcodes.length > 0) {
    const existingRes = await requestPool.query(
      `SELECT barcode
       FROM products
       WHERE barcode = ANY($1::text[])
         AND is_deleted = FALSE
         AND ($2::uuid IS NULL OR branch_id = $2)`,
      [barcodes, branchId]
    );
    existingRes.rows.forEach((row) => existingSet.add(row.barcode));
  }

  const seenInFile = new Set();
  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');

    for (let index = 0; index < rows.length; index += 1) {
      const raw = rows[index] || {};
      const rowNumber = index + 1;
      const name = String(raw.name || '').trim();
      const barcode = raw.barcode ? String(raw.barcode).trim() : null;
      const company = raw.company ? String(raw.company).trim() : null;
      const category = raw.category ? String(raw.category).trim() : null;
      const mrp = normalizeNumber(raw.mrp);
      const purchasePrice = normalizeNumber(raw.purchase_price);
      const sellingPrice = normalizeNumber(raw.selling_price);
      const batchNumber = raw.batch_number ? String(raw.batch_number).trim() : null;
      const expiryDate = normalizeDate(raw.expiry_date);
      const hsnCode = raw.hsn_code ? String(raw.hsn_code).trim() : null;
      const stockQuantity = normalizeNumber(raw.stock_quantity) ?? 0;
      const hasWeightValue = Object.prototype.hasOwnProperty.call(raw, 'is_weight_based');
      const isWeightBased = hasWeightValue
        ? normalizeWeightFlag(raw.is_weight_based, null)
        : null;
      const hasBatch = Boolean(batchNumber);

      let gstPercentage = normalizeNumber(raw.gst_percentage);
      if (gstPercentage === null) {
        gstPercentage = await resolveGstPercentage({ tenantPool: client }, hsnCode);
      } else if (hsnCode) {
        await upsertHsnGst(client, hsnCode, gstPercentage);
      }

      if (!name) {
        errors.push({ row: rowNumber, message: 'name is required' });
        continue;
      }
      if (!purchasePrice || purchasePrice <= 0) {
        errors.push({ row: rowNumber, message: 'purchase_price is required' });
        continue;
      }
      if (!sellingPrice || sellingPrice <= 0) {
        errors.push({ row: rowNumber, message: 'selling_price is required' });
        continue;
      }
      if (hasWeightValue && isWeightBased === null) {
        errors.push({
          row: rowNumber,
          message: 'is_weight_based must be piece/weight, 0/1, true/false, or yes/no',
        });
        continue;
      }

      if (barcode) {
        if (seenInFile.has(barcode)) {
          skipped += 1;
          continue;
        }
        seenInFile.add(barcode);
      }

      try {
        await client.query('SAVEPOINT product_import_row');

        if (barcode && existingSet.has(barcode)) {
          const updateRes = await client.query(
            `UPDATE products p
               SET name = $1,
                   company = COALESCE($2, p.company),
                   category = COALESCE($3, p.category),
                   selling_price = $4,
                   purchase_price = COALESCE($5, p.purchase_price),
                   mrp = COALESCE($6, p.mrp),
                   hsn_code = COALESCE($7, p.hsn_code),
                   gst_percentage = COALESCE($8, p.gst_percentage),
                   barcode = COALESCE($9, p.barcode),
                   stock_quantity = p.stock_quantity + COALESCE($10, 0),
                   expiry_date = COALESCE($11, p.expiry_date),
                   is_batch_enabled = CASE WHEN $12 THEN TRUE ELSE p.is_batch_enabled END,
                   branch_id = COALESCE(p.branch_id, $13),
                   is_weight_based = COALESCE($14, p.is_weight_based)
             WHERE p.barcode = $9
               AND p.is_deleted = FALSE
               AND ($13::uuid IS NULL OR p.branch_id = $13)
             RETURNING p.id`,
            [
              name,
              company,
              category,
              sellingPrice,
              purchasePrice,
              mrp,
              hsnCode,
              gstPercentage,
              barcode,
              stockQuantity,
              expiryDate,
              hasBatch,
              branchId,
              isWeightBased,
            ]
          );

          if (updateRes.rowCount > 0) {
            updated += 1;
            if (hasBatch) {
              await client.query(
                `INSERT INTO batches
                  (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  updateRes.rows[0].id,
                  branchId,
                  batchNumber,
                  expiryDate,
                  purchasePrice ?? null,
                  sellingPrice,
                  stockQuantity,
                ]
              );
            }
          } else {
            const insertRes = await client.query(
              `INSERT INTO products
                (name, company, category, selling_price, purchase_price, mrp, hsn_code, gst_percentage,
                 barcode, stock_quantity, expiry_date, is_batch_enabled, branch_id, is_weight_based)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               RETURNING id`,
              [
                name,
                company,
                category,
                sellingPrice,
                purchasePrice,
                mrp,
                hsnCode,
                gstPercentage,
                barcode,
                stockQuantity,
                expiryDate,
                hasBatch,
                branchId,
                isWeightBased ?? false,
              ]
            );
            if (hasBatch) {
              await client.query(
                `INSERT INTO batches
                  (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  insertRes.rows[0].id,
                  branchId,
                  batchNumber,
                  expiryDate,
                  purchasePrice ?? null,
                  sellingPrice,
                  stockQuantity,
                ]
              );
            }
            inserted += 1;
          }
        } else {
          const insertRes = await client.query(
            `INSERT INTO products
              (name, company, category, selling_price, purchase_price, mrp, hsn_code, gst_percentage,
               barcode, stock_quantity, expiry_date, is_batch_enabled, branch_id, is_weight_based)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id`,
            [
              name,
              company,
              category,
              sellingPrice,
              purchasePrice,
              mrp,
              hsnCode,
              gstPercentage,
              barcode,
              stockQuantity,
              expiryDate,
              hasBatch,
              branchId,
              isWeightBased ?? false,
            ]
          );
          if (hasBatch) {
            await client.query(
              `INSERT INTO batches
                (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                insertRes.rows[0].id,
                branchId,
                batchNumber,
                expiryDate,
                purchasePrice ?? null,
                sellingPrice,
                stockQuantity,
              ]
            );
          }
          inserted += 1;
        }
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT product_import_row');
        errors.push({ row: rowNumber, message: err.message || 'Insert failed' });
      }

      if (errors.length >= MAX_ERRORS) {
        errors.push({ row: rowNumber, message: 'Error limit reached; remaining rows skipped.' });
        break;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { total, inserted, updated, skipped, errors };
};

module.exports = { importProductsFromRows, normalizeWeightFlag };
