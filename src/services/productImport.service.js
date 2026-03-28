const xlsx = require('xlsx');
const pdfParse = require('pdf-parse');
const { resolveGstPercentage, upsertHsnGst } = require('./hsnGst.service');
const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const MAX_ERRORS = 50;

const normalizeHeader = (value) => String(value || '').trim().toLowerCase();

const HEADER_MAP = {
  'product name': 'name',
  product_name: 'name',
  name: 'name',
  barcode: 'barcode',
  category: 'category',
  mrp: 'mrp',
  mrp_price: 'mrp',
  'selling price': 'selling_price',
  selling_price: 'selling_price',
  sellingprice: 'selling_price',
  'purchase price': 'purchase_price',
  purchase_price: 'purchase_price',
  purchaseprice: 'purchase_price',
  rate: 'purchase_price',
  'Purchase Price': 'purchase_price',
  quantity: 'stock_quantity',
  qty: 'stock_quantity',
  stock: 'stock_quantity',
  stock_quantity: 'stock_quantity',
  hsn: 'hsn_code',
  hsn_code: 'hsn_code',
  gst: 'gst_percentage',
  gst_percentage: 'gst_percentage',
  gstpercent: 'gst_percentage',
  batch: 'batch_number',
  batch_number: 'batch_number',
  batchno: 'batch_number',
  'batch no': 'batch_number',
  expiry: 'expiry_date',
  'expiry date': 'expiry_date',
  expiry_date: 'expiry_date',
  exp: 'expiry_date',
  'exp date': 'expiry_date'
};

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

const normalizeRow = (row = {}) => {
  const mapped = {};
  Object.keys(row || {}).forEach((key) => {
    const normalized = HEADER_MAP[normalizeHeader(key)];
    if (normalized) {
      mapped[normalized] = row[key];
    }
  });
  return mapped;
};


const parseExcel = (buffer) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  return rawRows.map(normalizeRow);
};

const parsePdf = async (buffer) => {
  let data;
  try {
    data = await pdfParse(buffer);
  } catch (err) {
    const error = new Error('Unsupported or corrupted PDF');
    error.status = 400;
    throw error;
  }
  const text = String(data.text || '').trim();
  if (!text) {
    throw new Error('Unsupported format');
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new Error('Unsupported format');
  }
  const headerLineIndex = lines.findIndex((line) =>
    line.toLowerCase().includes('name') && line.toLowerCase().includes('price')
  );
  if (headerLineIndex === -1) {
    throw new Error('Unsupported format');
  }
  const headerLine = lines[headerLineIndex];
  const delimiter = headerLine.includes('|')
    ? '|'
    : headerLine.includes(',')
    ? ','
    : headerLine.includes('\t')
    ? '\t'
    : null;
  if (!delimiter) {
    throw new Error('Unsupported format');
  }
  const headers = headerLine.split(delimiter).map((h) => h.trim());
  const rows = [];
  for (let i = headerLineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const cells = line.split(delimiter).map((cell) => cell.trim());
    if (cells.length === 0) continue;
    const row = headers.reduce((acc, header, index) => {
      acc[header] = cells[index] ?? '';
      return acc;
    }, {});
    rows.push(normalizeRow(row));
  }
  return rows;
};

const loadRows = async (file) => {
  const filename = String(file.originalname || '').toLowerCase();
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.csv')) {
    return parseExcel(file.buffer);
  }
  if (filename.endsWith('.pdf')) {
    return await parsePdf(file.buffer);
  }
  throw new Error('Unsupported format');
};

const importProducts = async (req, file) => {
  if (!file) {
    const error = new Error('file is required.');
    error.status = 400;
    throw error;
  }

  let rows = [];
  try {
    rows = await loadRows(file);
  } catch (error) {
    if (error.message === 'Unsupported format') {
      error.status = 400;
    }
    throw error;
  }
  const requestPool = getRequestPool(req);
  const branchId = resolveBranchIdFromRequest(req);

  const total = rows.length;
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  if (total === 0) {
    return { total, inserted, skipped, errors };
  }

  const barcodes = rows
    .map((row) => (row.barcode ? String(row.barcode).trim() : null))
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
      const raw = rows[index];
      const rowNumber = index + 2;
      const name = String(raw.name || '').trim();
      const barcode = raw.barcode ? String(raw.barcode).trim() : null;
      const category = raw.category ? String(raw.category).trim() : null;
      const mrp = normalizeNumber(raw.mrp);
      const purchase_price = normalizeNumber(raw.purchase_price);
      const batch_number = raw.batch_number ? String(raw.batch_number).trim() : null;
      const expiry_date = normalizeDate(raw.expiry_date);
      const hsn_code = raw.hsn_code ? String(raw.hsn_code).trim() : null;
      const stock_quantity = normalizeNumber(raw.stock_quantity) ?? 0;
      let gst_percentage = normalizeNumber(raw.gst_percentage);
      if (gst_percentage === null) {
        gst_percentage = await resolveGstPercentage({ tenantPool: client }, hsn_code);
      } else if (hsn_code) {
        await upsertHsnGst(client, hsn_code, gst_percentage);
      }

      if (!name) {
        errors.push({ row: rowNumber, message: 'name is required' });
        continue;
      }
      if (!purchase_price || purchase_price <= 0) {
        errors.push({ row: rowNumber, message: 'purchase_price is required' });
        continue;
      }
      if (barcode) {
        // Skip duplicate barcodes within the same import file.
        if (seenInFile.has(barcode)) {
          skipped += 1;
          continue;
        }
        seenInFile.add(barcode);
      }

      const selling_price = 0;
      const resolvedPurchasePrice = purchase_price;
      const hasBatch = Boolean(batch_number);

      try {
        await client.query('SAVEPOINT product_import_row');
        if (barcode && existingSet.has(barcode)) {
          const updateRes = await client.query(
            `UPDATE products p
               SET
                 name = $1,
                 category = COALESCE($2, p.category),
                 purchase_price = COALESCE($3, p.purchase_price),
                 mrp = COALESCE($4, p.mrp),
                 hsn_code = COALESCE($5, p.hsn_code),
                 gst_percentage = COALESCE($6, p.gst_percentage),
                 barcode = COALESCE($7, p.barcode),
                 stock_quantity = p.stock_quantity + COALESCE($8, 0),
                 expiry_date = COALESCE($9, p.expiry_date),
                 is_batch_enabled = CASE WHEN $10 THEN TRUE ELSE p.is_batch_enabled END,
                 branch_id = COALESCE(p.branch_id, $11)
             WHERE p.barcode = $7
               AND p.is_deleted = FALSE
               AND ($11::uuid IS NULL OR p.branch_id = $11)
             RETURNING p.id`,
            [
              name,
              category,
              purchase_price,
              mrp,
              hsn_code,
              gst_percentage,
              barcode,
              stock_quantity,
              expiry_date,
              hasBatch,
              branchId
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
                  batch_number,
                  expiry_date,
                  resolvedPurchasePrice ?? null,
                  selling_price,
                  stock_quantity
                ]
              );
            }
          } else {
            // Fallback: if barcode existed in the pre-query but got deleted, insert.
            const insertRes = await client.query(
              `INSERT INTO products
                (name, category, selling_price, purchase_price, mrp, hsn_code, gst_percentage, barcode, stock_quantity, expiry_date, is_batch_enabled, branch_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               RETURNING id`,
              [
                name,
                category,
                selling_price,
                resolvedPurchasePrice,
                mrp,
                hsn_code,
                gst_percentage,
                barcode,
                stock_quantity,
                expiry_date,
                hasBatch,
                branchId
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
                  batch_number,
                  expiry_date,
                  resolvedPurchasePrice ?? null,
                  selling_price,
                  stock_quantity
                ]
              );
            }
            inserted += 1;
          }
        } else {
          const insertRes = await client.query(
            `INSERT INTO products
              (name, category, selling_price, purchase_price, mrp, hsn_code, gst_percentage, barcode, stock_quantity, expiry_date, is_batch_enabled, branch_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [
              name,
              category,
              selling_price,
              resolvedPurchasePrice,
              mrp,
              hsn_code,
              gst_percentage,
              barcode,
              stock_quantity,
              expiry_date,
              hasBatch,
              branchId
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
                batch_number,
                expiry_date,
                resolvedPurchasePrice ?? null,
                selling_price,
                stock_quantity
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
      const category = raw.category ? String(raw.category).trim() : null;
      const mrp = normalizeNumber(raw.mrp);
      const purchase_price = normalizeNumber(raw.purchase_price);
      const selling_price = normalizeNumber(raw.selling_price);
      const batch_number = raw.batch_number ? String(raw.batch_number).trim() : null;
      const expiry_date = normalizeDate(raw.expiry_date);
      const hsn_code = raw.hsn_code ? String(raw.hsn_code).trim() : null;
      const stock_quantity = normalizeNumber(raw.stock_quantity) ?? 0;
      const hasBatch = Boolean(batch_number);
      let gst_percentage = normalizeNumber(raw.gst_percentage);
      if (gst_percentage === null) {
        gst_percentage = await resolveGstPercentage({ tenantPool: client }, hsn_code);
      } else if (hsn_code) {
        await upsertHsnGst(client, hsn_code, gst_percentage);
      }

      if (!name) {
        errors.push({ row: rowNumber, message: 'name is required' });
        continue;
      }
      if (!purchase_price || purchase_price <= 0) {
        errors.push({ row: rowNumber, message: 'purchase_price is required' });
        continue;
      }
      if (!selling_price || selling_price <= 0) {
        errors.push({ row: rowNumber, message: 'selling_price is required' });
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
               SET
                 name = $1,
                 category = COALESCE($2, p.category),
                 selling_price = $3,
                 purchase_price = COALESCE($4, p.purchase_price),
                 mrp = COALESCE($5, p.mrp),
                 hsn_code = COALESCE($6, p.hsn_code),
                 gst_percentage = COALESCE($7, p.gst_percentage),
                 barcode = COALESCE($8, p.barcode),
                 stock_quantity = p.stock_quantity + COALESCE($9, 0),
                 expiry_date = COALESCE($10, p.expiry_date),
                 is_batch_enabled = CASE WHEN $11 THEN TRUE ELSE p.is_batch_enabled END,
                 branch_id = COALESCE(p.branch_id, $12)
             WHERE p.barcode = $8
               AND p.is_deleted = FALSE
               AND ($12::uuid IS NULL OR p.branch_id = $12)
             RETURNING p.id`,
            [
              name,
              category,
              selling_price,
              purchase_price,
              mrp,
              hsn_code,
              gst_percentage,
              barcode,
              stock_quantity,
              expiry_date,
              hasBatch,
              branchId
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
                  batch_number,
                  expiry_date,
                  purchase_price ?? null,
                  selling_price,
                  stock_quantity
                ]
              );
            }
          } else {
            const insertRes = await client.query(
              `INSERT INTO products
                (name, category, selling_price, purchase_price, mrp, hsn_code, gst_percentage, barcode, stock_quantity, expiry_date, is_batch_enabled, branch_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               RETURNING id`,
              [
                name,
                category,
                selling_price,
                purchase_price,
                mrp,
                hsn_code,
                gst_percentage,
                barcode,
                stock_quantity,
                expiry_date,
                hasBatch,
                branchId
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
                  batch_number,
                  expiry_date,
                  purchase_price ?? null,
                  selling_price,
                  stock_quantity
                ]
              );
            }
            inserted += 1;
          }
        } else {
          const insertRes = await client.query(
            `INSERT INTO products
              (name, category, selling_price, purchase_price, mrp, hsn_code, gst_percentage, barcode, stock_quantity, expiry_date, is_batch_enabled, branch_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [
              name,
              category,
              selling_price,
              purchase_price,
              mrp,
              hsn_code,
              gst_percentage,
              barcode,
              stock_quantity,
              expiry_date,
              hasBatch,
              branchId
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
                batch_number,
                expiry_date,
                purchase_price ?? null,
                selling_price,
                stock_quantity
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

module.exports = { importProducts, importProductsFromRows };


