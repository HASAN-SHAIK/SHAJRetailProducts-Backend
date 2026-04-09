const pool = require('../db');
const nodemailer = require('nodemailer');

const getRequestPool = (req) => req.tenantPool || pool;

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const buildTransporter = () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host || !user || !pass) {
    const error = new Error('SMTP not configured');
    error.status = 400;
    throw error;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
};

const getLastPurchasePriceMap = async (client, productIds = []) => {
  if (!productIds.length) return new Map();
  const res = await client.query(
    `SELECT oi.product_id,
            oi.purchase_price_snapshot AS purchase_price,
            o.created_at
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.transaction_type = 'purchase'
       AND oi.product_id = ANY($1::int[])
     ORDER BY o.created_at DESC`,
    [productIds]
  );
  const map = new Map();
  for (const row of res.rows) {
    if (!map.has(row.product_id)) {
      map.set(row.product_id, row.purchase_price);
    }
  }
  return map;
};

const createPurchaseRequest = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  const supplierId = normalizeNumber(payload.supplier_id);
  if (!Number.isFinite(supplierId)) {
    const error = new Error('supplier_id is required');
    error.status = 400;
    throw error;
  }
  const branchId = payload.branch_id;
  if (branchId && !isUuid(branchId)) {
    const error = new Error('branch_id is invalid');
    error.status = 400;
    throw error;
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    const error = new Error('items must be a non-empty array');
    error.status = 400;
    throw error;
  }

  const client = await requestPool.connect();
  try {
    await client.query('BEGIN');
    const supplierRes = await client.query('SELECT id FROM suppliers WHERE id = $1 AND is_deleted = FALSE', [supplierId]);
    if (supplierRes.rowCount === 0) {
      const error = new Error('supplier not found');
      error.status = 400;
      throw error;
    }

    const reqRes = await client.query(
      `INSERT INTO purchase_requests (supplier_id, branch_id, status, expected_date, notes)
       VALUES ($1, $2, 'DRAFT', $3, $4)
       RETURNING id, created_at`,
      [supplierId, branchId || null, payload.expected_date || null, payload.notes || null]
    );
    const requestId = reqRes.rows[0].id;

    const productIds = items
      .map((item) => normalizeNumber(item.product_id || item.productId))
      .filter((id) => Number.isFinite(id));
    const lastPriceMap = await getLastPurchasePriceMap(client, productIds);

    const insertValues = [];
    const placeholders = [];
    let idx = 1;
    for (const item of items) {
      const productId = normalizeNumber(item.product_id || item.productId);
      const qty = normalizeNumber(item.quantity);
      if (!Number.isFinite(productId) || !Number.isFinite(qty) || qty <= 0) continue;
      const lastPrice = normalizeNumber(item.last_purchase_price);
      const resolvedPrice =
        Number.isFinite(lastPrice) ? lastPrice : (lastPriceMap.get(productId) || null);
      insertValues.push(requestId, productId, qty, resolvedPrice);
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
      idx += 4;
    }
    if (!placeholders.length) {
      const error = new Error('No valid items provided');
      error.status = 400;
      throw error;
    }
    await client.query(
      `INSERT INTO purchase_request_items (purchase_request_id, product_id, quantity, last_purchase_price)
       VALUES ${placeholders.join(', ')}`,
      insertValues
    );

    await client.query('COMMIT');
    return { id: requestId, created_at: reqRes.rows[0].created_at };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getPurchaseRequestById = async (req, requestId) => {
  const requestPool = getRequestPool(req);
  const id = normalizeNumber(requestId);
  if (!Number.isFinite(id)) {
    const error = new Error('request_id is invalid');
    error.status = 400;
    throw error;
  }
  const headerRes = await requestPool.query(
    `SELECT pr.*, s.name AS supplier_name, s.email AS supplier_email
     FROM purchase_requests pr
     JOIN suppliers s ON s.id = pr.supplier_id
     WHERE pr.id = $1`,
    [id]
  );
  if (headerRes.rowCount === 0) {
    const error = new Error('request not found');
    error.status = 404;
    throw error;
  }
  const itemsRes = await requestPool.query(
    `SELECT pri.*, p.name AS product_name
     FROM purchase_request_items pri
     JOIN products p ON p.id = pri.product_id
     WHERE pri.purchase_request_id = $1`,
    [id]
  );
  return { request: headerRes.rows[0], items: itemsRes.rows };
};

const sendPurchaseRequestEmail = async (req, requestId) => {
  const { request, items } = await getPurchaseRequestById(req, requestId);
  const supplierEmail = request?.supplier_email;
  if (!supplierEmail) {
    const error = new Error('supplier email not found');
    error.status = 400;
    throw error;
  }
  const transporter = buildTransporter();
  const lines = items
    .map(
      (item, idx) =>
        `<tr>
          <td>${idx + 1}</td>
          <td>${item.product_name || '-'}</td>
          <td style="text-align:right;">${item.quantity}</td>
          <td style="text-align:right;">${item.last_purchase_price ?? '-'}</td>
        </tr>`
    )
    .join('');
  const html = `
    <div>
      <h3>Purchase Request #${request.id}</h3>
      <p>Expected Date: ${request.expected_date || '-'}</p>
      <p>Notes: ${request.notes || '-'}</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr>
            <th>#</th>
            <th>Product</th>
            <th>Qty</th>
            <th>Last Price</th>
          </tr>
        </thead>
        <tbody>${lines}</tbody>
      </table>
    </div>
  `;
  await transporter.sendMail({
    to: supplierEmail,
    subject: `Purchase Request #${request.id}`,
    html
  });

  const requestPool = getRequestPool(req);
  await requestPool.query(
    `UPDATE purchase_requests
     SET status = 'SENT'
     WHERE id = $1`,
    [request.id]
  );
  return { id: request.id, status: 'SENT' };
};

module.exports = {
  createPurchaseRequest,
  getPurchaseRequestById,
  sendPurchaseRequestEmail
};
