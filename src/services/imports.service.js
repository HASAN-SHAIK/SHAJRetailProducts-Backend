const pool = require('../db');
const { resolveBranchIdFromRequest, isUuid } = require('../utils/branch');
const { resolveGstPercentage, upsertHsnGst } = require('./hsnGst.service');

const getRequestPool = (req) => req.tenantPool || pool;

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

const isTempId = (value) => {
  const text = String(value || '');
  return text.startsWith('temp:') || text.startsWith('local:') || text.startsWith('tmp:');
};

const importOfflineItems = async (req, payload = {}) => {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    const err = new Error('items are required.');
    err.status = 400;
    throw err;
  }

  const requestPool = getRequestPool(req);
  const branchId =
    payload.branchId ||
    payload.branch_id ||
    resolveBranchIdFromRequest(req);

  const summary = {
    total: items.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };
  const mappings = [];

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < items.length; index += 1) {
      const raw = items[index] || {};
      const rowNumber = index + 1;
      const name = String(raw.name || raw.productName || '').trim();
      const barcode = raw.barcode ? String(raw.barcode).trim() : null;
      const company = raw.company ? String(raw.company).trim() : null;
      const category = raw.category ? String(raw.category).trim() : null;
      const batchNo = raw.batchNo ? String(raw.batchNo).trim() : null;
      const expiryDate = normalizeDate(raw.expiryDate || raw.expiry_date);
      const qty = normalizeNumber(raw.qty ?? raw.quantity ?? raw.stock_quantity) ?? 0;
      const purchasePrice = normalizeNumber(raw.costPrice ?? raw.purchase_price);
      const sellingPrice = normalizeNumber(raw.sellingPrice ?? raw.selling_price);
      const mrp = normalizeNumber(raw.mrp);
      const hsnCode = raw.hsnCode ? String(raw.hsnCode).trim() : (raw.hsn_code ? String(raw.hsn_code).trim() : null);
      let gstPercent = normalizeNumber(raw.gstPercent ?? raw.gst_percentage);
      const incomingProductId = raw.productId || raw.product_id || null;

      if (!name) {
        summary.errors.push({ row: rowNumber, message: 'name is required' });
        continue;
      }
      if (!purchasePrice || purchasePrice <= 0) {
        summary.errors.push({ row: rowNumber, message: 'purchase_price is required' });
        continue;
      }
      if (!sellingPrice || sellingPrice <= 0) {
        summary.errors.push({ row: rowNumber, message: 'selling_price is required' });
        continue;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        summary.skipped += 1;
        continue;
      }

      if (gstPercent === null) {
        gstPercent = await resolveGstPercentage({ tenantPool: client }, hsnCode);
      } else if (hsnCode) {
        await upsertHsnGst(client, hsnCode, gstPercent);
      }

      try {
        await client.query('SAVEPOINT offline_import_row');
        let existingId = null;
        if (barcode) {
          const existingRes = await client.query(
            `SELECT id
               FROM products
              WHERE barcode = $1
                AND is_deleted = FALSE
                AND ($2::uuid IS NULL OR branch_id = $2)
              LIMIT 1`,
            [barcode, branchId]
          );
          existingId = existingRes.rows[0]?.id || null;
        }
        if (!existingId && incomingProductId && isUuid(String(incomingProductId))) {
          const byId = await client.query(
            `SELECT id
               FROM products
              WHERE id = $1
                AND is_deleted = FALSE
                AND ($2::uuid IS NULL OR branch_id = $2)
              LIMIT 1`,
            [incomingProductId, branchId]
          );
          existingId = byId.rows[0]?.id || null;
        }

        if (existingId) {
          await client.query(
            `UPDATE products p
               SET
                 name = $1,
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
                 branch_id = COALESCE(p.branch_id, $13)
             WHERE p.id = $14`,
            [
              name,
              company,
              category,
              sellingPrice,
              purchasePrice,
              mrp,
              hsnCode,
              gstPercent,
              barcode,
              qty,
              expiryDate,
              Boolean(batchNo),
              branchId,
              existingId
            ]
          );
          summary.updated += 1;
          if (isTempId(incomingProductId)) {
            mappings.push({ tempId: incomingProductId, realId: existingId });
          }
        } else {
          const insertRes = await client.query(
            `INSERT INTO products
              (name, company, category, selling_price, purchase_price, mrp, hsn_code, gst_percentage, barcode, stock_quantity, expiry_date, is_batch_enabled, branch_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id`,
            [
              name,
              company,
              category,
              sellingPrice,
              purchasePrice,
              mrp,
              hsnCode,
              gstPercent,
              barcode,
              qty,
              expiryDate,
              Boolean(batchNo),
              branchId
            ]
          );
          const newId = insertRes.rows[0]?.id;
          summary.inserted += 1;
          if (isTempId(incomingProductId) && newId) {
            mappings.push({ tempId: incomingProductId, realId: newId });
          }
          existingId = newId;
        }

        if (existingId && batchNo) {
          const batchRes = await client.query(
            `SELECT id, quantity
               FROM batches
              WHERE product_id = $1
                AND batch_number = $2
                AND ($3::date IS NULL OR expiry_date = $3)
                AND ($4::uuid IS NULL OR branch_id = $4)
              LIMIT 1`,
            [existingId, batchNo, expiryDate, branchId]
          );
          if (batchRes.rows[0]) {
            await client.query(
              `UPDATE batches
                  SET quantity = COALESCE(quantity, 0) + $1,
                      quantity_remaining = COALESCE(quantity_remaining, quantity, 0) + $1,
                      purchase_price = COALESCE($2, purchase_price),
                      selling_price = COALESCE($3, selling_price)
                WHERE id = $4`,
              [qty, purchasePrice, sellingPrice, batchRes.rows[0].id]
            );
          } else {
            await client.query(
              `INSERT INTO batches
                (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity, quantity_remaining)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
              [
                existingId,
                branchId,
                batchNo,
                expiryDate,
                purchasePrice ?? null,
                sellingPrice,
                qty
              ]
            );
          }
        }
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT offline_import_row');
        summary.errors.push({ row: rowNumber, message: err.message || 'Insert failed' });
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { summary, mappings };
};

module.exports = { importOfflineItems };
