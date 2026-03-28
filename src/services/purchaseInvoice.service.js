const pdfParse = require('pdf-parse');
const pool = require('../db');
const { resolveGstPercentage, upsertHsnGst } = require('./hsnGst.service');

const getRequestPool = (req) => req.tenantPool || pool;

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseDelimitedLine = (line) => {
  if (line.includes('|')) {
    return line.split('|').map((part) => part.trim());
  }
  if (line.includes('\t')) {
    return line.split('\t').map((part) => part.trim());
  }
  return line.split(/\s{2,}/).map((part) => part.trim());
};

const parseInvoicePdf = async (buffer) => {
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
    const error = new Error('Unsupported format');
    error.status = 400;
    throw error;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headerIndex = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return lower.includes('hsn') && (lower.includes('qty') || lower.includes('quantity'));
  });

  if (headerIndex === -1) {
    const error = new Error('Unsupported format');
    error.status = 400;
    throw error;
  }

  const headers = parseDelimitedLine(lines[headerIndex]).map((h) => h.toLowerCase());
  const colIndex = (key) => headers.findIndex((h) => h.includes(key));
  const nameIndex = colIndex('name');
  const hsnIndex = colIndex('hsn');
  const qtyIndex = colIndex('qty');
  const priceIndex =
    colIndex('price') !== -1
      ? colIndex('price')
      : colIndex('rate') !== -1
      ? colIndex('rate')
      : colIndex('purchase');
  const gstIndex = colIndex('gst');

  if (nameIndex === -1 || qtyIndex === -1 || priceIndex === -1) {
    const error = new Error('Unsupported format');
    error.status = 400;
    throw error;
  }

  const items = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const row = parseDelimitedLine(lines[i]);
    if (!row.length || row.length < Math.max(nameIndex, qtyIndex, priceIndex) + 1) {
      continue;
    }
    const name = row[nameIndex] || '';
    const qty = normalizeNumber(row[qtyIndex]);
    const purchase_price = normalizeNumber(row[priceIndex]);
    if (!name || !qty || !purchase_price) {
      continue;
    }
    const hsn = hsnIndex !== -1 ? row[hsnIndex] || '' : '';
    const gst_percent = gstIndex !== -1 ? normalizeNumber(row[gstIndex]) : null;
    items.push({
      name: String(name).trim(),
      hsn: hsn ? String(hsn).trim() : null,
      qty,
      purchase_price,
      gst_percent
    });
  }

  if (!items.length) {
    const error = new Error('Unsupported format');
    error.status = 400;
    throw error;
  }

  return items;
};

const parseInvoice = async (req, file) => {
  if (!file) {
    const error = new Error('file is required');
    error.status = 400;
    throw error;
  }
  const filename = String(file.originalname || '').toLowerCase();
  if (!filename.endsWith('.pdf')) {
    const error = new Error('Unsupported format');
    error.status = 400;
    throw error;
  }
  return await parseInvoicePdf(file.buffer);
};

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const savePurchase = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    const error = new Error('items must be a non-empty array');
    error.status = 400;
    throw error;
  }

  const branchId = payload.branch_id;
  if (branchId && !isUuid(branchId)) {
    const error = new Error('branch_id is invalid');
    error.status = 400;
    throw error;
  }

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');
    const results = [];

    for (const item of items) {
      const name = String(item.name || '').trim();
      const qty = normalizeNumber(item.qty);
      const purchase_price = normalizeNumber(item.purchase_price);
      if (!name || !qty || !purchase_price) {
        continue;
      }
      const hsn = item.hsn ? String(item.hsn).trim() : null;
      let gst_percent = normalizeNumber(item.gst_percent);
      if (gst_percent === null) {
        gst_percent = await resolveGstPercentage({ tenantPool: client }, hsn);
      } else if (hsn) {
        await upsertHsnGst(client, hsn, gst_percent);
      }
      const batch_number = item.batch_number ? String(item.batch_number).trim() : null;
      const expiry_date = item.expiry_date ? new Date(item.expiry_date) : null;
      const selling_price = normalizeNumber(item.selling_price);

      let productId = normalizeNumber(item.product_id);
      let existingSelling = null;

      if (productId) {
        const existingRes = await client.query(
          `SELECT id, selling_price FROM products WHERE id = $1 AND is_deleted = FALSE`,
          [productId]
        );
        if (existingRes.rowCount === 0) {
          productId = null;
        } else {
          existingSelling = existingRes.rows[0].selling_price;
        }
      }

      if (!productId) {
        const byNameRes = await client.query(
          `SELECT id, selling_price FROM products
           WHERE LOWER(name) = LOWER($1) AND is_deleted = FALSE
           ORDER BY id ASC
           LIMIT 1`,
          [name]
        );
        if (byNameRes.rowCount > 0) {
          productId = byNameRes.rows[0].id;
          existingSelling = byNameRes.rows[0].selling_price;
        }
      }

      if (!productId) {
        const insertRes = await client.query(
          `INSERT INTO products
            (name, category, selling_price, purchase_price, purchase_price, hsn_code, gst_percentage, stock_quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, selling_price`,
          [
            name,
            item.category || null,
            selling_price || purchase_price,
            purchase_price,
            purchase_price,
            hsn,
            gst_percent,
            0
          ]
        );
        productId = insertRes.rows[0].id;
        existingSelling = insertRes.rows[0].selling_price;
      }

      await client.query(
        `INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          productId,
          branchId || null,
          batch_number,
          expiry_date && !Number.isNaN(expiry_date.getTime()) ? expiry_date : null,
          purchase_price,
          selling_price || existingSelling || null,
          qty
        ]
      );

      const updateValues = [qty, purchase_price, productId];
      let updateSql =
        'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + $1, purchase_price = $2, purchase_price = $2';
      if (selling_price) {
        updateSql += ', selling_price = $4';
        updateValues.push(selling_price);
      }
      updateSql += ' WHERE id = $3';

      await client.query(updateSql, updateValues);

      results.push({ product_id: productId, qty, purchase_price, selling_price: selling_price || null });
    }

    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { parseInvoice, savePurchase };

