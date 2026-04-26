const pool = require('../db');
const axios = require('axios');
const getRequestPool = (req) => req.tenantPool || pool;

const normalizePhone = (value) => String(value || '').replace(/\D+/g, '');
const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const formatMoney = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

const buildBillMessage = ({ orderId, items, gstAmount, totalAmount }) => {
  const lines = [];
  lines.push(`Bill #${orderId}`);
  lines.push('Items:');
  items.forEach((item) => {
    lines.push(`* ${item.name} x${item.qty} = INR ${formatMoney(item.line_total)}`);
  });
  lines.push('');
  lines.push(`GST: INR ${formatMoney(gstAmount)}`);
  lines.push(`Total: INR ${formatMoney(totalAmount)}`);
  return lines.join('\n');
};

const buildE164Phone = (rawPhone) => {
  const digits = normalizePhone(rawPhone);
  if (!digits) return null;
  if (digits.length === 10) {
    const cc = normalizePhone(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '91');
    return cc ? `+${cc}${digits}` : `+${digits}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
};

const sendWhatsAppMessage = async ({ phone, message }) => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v20.0';

  if (!token || !phoneNumberId) {
    const err = new Error('WhatsApp credentials are not configured.');
    err.status = 500;
    throw err;
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: {
      preview_url: false,
      body: message
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    const err = new Error(
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error.message ||
      'Failed to send WhatsApp message'
    );
    err.status = error?.response?.status || 500;
    err.details = error?.response?.data || null;
    throw err;
  }
};

const ensureWhatsAppEnabled = async (req, requestPool) => {
  if (req?.featureFlags && Object.prototype.hasOwnProperty.call(req.featureFlags, 'WHATSAPP_BILL')) {
    if (!req.featureFlags.WHATSAPP_BILL) {
      const err = new Error('Module disabled');
      err.status = 403;
      throw err;
    }
    return;
  }

  const settingsRes = await requestPool.query(
    'SELECT whatsapp_bill_module FROM settings ORDER BY id ASC LIMIT 1'
  );
  let enabled = settingsRes.rowCount > 0 && settingsRes.rows[0]?.whatsapp_bill_module === true;
  if (settingsRes.rowCount === 0) {
    await requestPool.query('INSERT INTO settings (whatsapp_bill_module) VALUES (FALSE)');
    enabled = false;
  }
  if (!enabled) {
    const err = new Error('Module disabled');
    err.status = 403;
    throw err;
  }
};

const sendBill = async (req, { phone, order_id }) => {
  const e164Phone = buildE164Phone(phone);
  if (!e164Phone) {
    const err = new Error('Valid phone number is required.');
    err.status = 400;
    throw err;
  }

  const requestPool = getRequestPool(req);
  await ensureWhatsAppEnabled(req, requestPool);

  let orderLabel = null;
  let gstAmount = 0;
  let totalAmount = 0;
  let items = [];

  if (isUuid(order_id)) {
    const orderRes = await requestPool.query(
      `SELECT id, bill_number, total_amount, gst_amount
       FROM billing_orders
       WHERE id = $1`,
      [order_id]
    );
    if (orderRes.rowCount === 0) {
      const err = new Error('Order not found.');
      err.status = 404;
      throw err;
    }

    const orderRow = orderRes.rows[0];
    orderLabel = orderRow.bill_number || orderRow.id;
    gstAmount = Number(orderRow.gst_amount || 0);
    totalAmount = Number(orderRow.total_amount || 0);

    const itemsRes = await requestPool.query(
      `SELECT p.name,
              boi.quantity,
              boi.price,
              boi.total
       FROM billing_order_items boi
       LEFT JOIN products p ON p.id = boi.product_id
       WHERE boi.order_id = $1
       ORDER BY boi.id ASC`,
      [orderRow.id]
    );

    items = itemsRes.rows.map((row) => {
      const qty = Number(row.quantity || 0);
      const price = Number(row.price || 0);
      const lineTotal = Number(row.total || qty * price);
      return {
        name: row.name || '-',
        qty,
        price,
        gst_percentage: 0,
        line_total: lineTotal
      };
    });
  } else {
    const orderId = Number(order_id);
    if (!Number.isFinite(orderId)) {
      const err = new Error('Valid order_id is required.');
      err.status = 400;
      throw err;
    }

    const orderRes = await requestPool.query(
      `SELECT id, total_price, is_gst_enabled
       FROM orders
       WHERE id = $1`,
      [orderId]
    );
    if (orderRes.rowCount === 0) {
      const err = new Error('Order not found.');
      err.status = 404;
      throw err;
    }

    const orderRow = orderRes.rows[0];
    orderLabel = orderRow.id;
    const itemsRes = await requestPool.query(
      `SELECT p.name,
              oi.quantity,
              oi.selling_price,
              p.gst_percentage
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    items = itemsRes.rows.map((row) => {
      const qty = Number(row.quantity || 0);
      const price = Number(row.selling_price || 0);
      const lineTotal = qty * price;
      return {
        name: row.name || '-',
        qty,
        price,
        gst_percentage: Number(row.gst_percentage || 0),
        line_total: lineTotal
      };
    });

    const gstEnabled = orderRow.is_gst_enabled === true;
    gstAmount = gstEnabled
      ? items.reduce((sum, item) => sum + (item.line_total * item.gst_percentage) / 100, 0)
      : 0;
    totalAmount = Number(orderRow.total_price || 0) + gstAmount;
  }

  const message = buildBillMessage({
    orderId: orderLabel,
    items,
    gstAmount,
    totalAmount
  });

  const providerResponse = await sendWhatsAppMessage({
    phone: e164Phone,
    message
  });

  return { phone: e164Phone, order_id, message, provider: providerResponse };
};

const sendText = async (req, { phone, message }, options = {}) => {
  const e164Phone = buildE164Phone(phone);
  if (!e164Phone) {
    const err = new Error('Valid phone number is required.');
    err.status = 400;
    throw err;
  }
  const trimmed = String(message || '').trim();
  if (!trimmed) {
    const err = new Error('Message is required.');
    err.status = 400;
    throw err;
  }

  const requestPool = options.requestPool || getRequestPool(req || {});
  if (options.skipModuleCheck !== true) {
    await ensureWhatsAppEnabled(req || {}, requestPool);
  }

  const providerResponse = await sendWhatsAppMessage({
    phone: e164Phone,
    message: trimmed
  });
  return { phone: e164Phone, message: trimmed, provider: providerResponse };
};

module.exports = { sendBill, sendText };
