const nodemailer = require('nodemailer');
const masterPool = require('../db/masterPool');
const { getTenantPool } = require('../db/tenantPool');
const whatsappService = require('./whatsapp.service');

const DEFAULT_TIMEZONE = process.env.OWNER_DIGEST_DEFAULT_TZ || 'Asia/Kolkata';
const DEFAULT_DIGEST_TIME = process.env.OWNER_DIGEST_DEFAULT_TIME || '09:00';
const DEFAULT_LOW_STOCK_THRESHOLD = Math.max(
  1,
  Number(process.env.OWNER_DIGEST_DEFAULT_LOW_STOCK_THRESHOLD || 5)
);

const SALES_STATUSES = ['completed', 'partially_returned', 'fully_returned'];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const sanitizeTime = (value, fallback = DEFAULT_DIGEST_TIME) => {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : fallback;
};

const normalizePhone = (value) => String(value || '').replace(/\D+/g, '');

const sanitizeTimezone = (value) => {
  const zone = String(value || '').trim();
  if (!zone) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
};

const formatMoney = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value));

const shiftDateText = (dateText, deltaDays) => {
  const [year, month, day] = String(dateText || '')
    .split('-')
    .map((part) => Number(part));
  if (!year || !month || !day) return dateText;
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getLocalParts = (date, timezone) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour || 0),
    minute: Number(map.minute || 0),
  };
};

const parseMinutes = (timeText) => {
  const [hour, minute] = String(timeText || '00:00')
    .split(':')
    .map((value) => Number(value));
  return hour * 60 + minute;
};

const ensureOwnerDigestSchema = async (client) => {
  await client.query(
    `CREATE TABLE IF NOT EXISTS owner_daily_digest_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      send_time TIME NOT NULL DEFAULT '09:00',
      recipient_email TEXT,
      recipient_phone TEXT,
      low_stock_threshold INT NOT NULL DEFAULT 5,
      include_out_of_stock BOOLEAN NOT NULL DEFAULT TRUE,
      include_credit_summary BOOLEAN NOT NULL DEFAULT TRUE,
      include_supplier_dues BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS owner_daily_digest_deliveries (
      id BIGSERIAL PRIMARY KEY,
      report_date DATE NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
      recipient TEXT,
      payload TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      UNIQUE (report_date, channel)
    )`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_owner_daily_digest_deliveries_date
     ON owner_daily_digest_deliveries (report_date DESC, channel)`
  );
};

const getTenantContact = async (tenantId) => {
  if (!tenantId) return { owner_email: null, owner_phone: null, shop_name: null };
  const result = await masterPool.query(
    `SELECT shop_name, owner_name, email, mobile
     FROM tenants
     WHERE id = $1`,
    [tenantId]
  );
  const row = result.rows[0] || {};
  return {
    owner_name: row.owner_name || null,
    owner_email: row.email || null,
    owner_phone: row.mobile || null,
    shop_name: row.shop_name || null,
  };
};

const getSettings = async (requestPool, context = {}) => {
  const client = await requestPool.connect();
  try {
    await ensureOwnerDigestSchema(client);
    const contact = context.contact || {};
    const defaults = {
      is_enabled: true,
      email_enabled: true,
      whatsapp_enabled: true,
      timezone: sanitizeTimezone(context.timezone || DEFAULT_TIMEZONE),
      send_time: sanitizeTime(context.send_time || DEFAULT_DIGEST_TIME),
      recipient_email: String(contact.owner_email || context.recipient_email || '').trim() || null,
      recipient_phone: normalizePhone(contact.owner_phone || context.recipient_phone || '') || null,
      low_stock_threshold: DEFAULT_LOW_STOCK_THRESHOLD,
      include_out_of_stock: true,
      include_credit_summary: true,
      include_supplier_dues: true,
    };
    await client.query(
      `INSERT INTO owner_daily_digest_settings (
          id, is_enabled, email_enabled, whatsapp_enabled, timezone, send_time,
          recipient_email, recipient_phone, low_stock_threshold, include_out_of_stock,
          include_credit_summary, include_supplier_dues
       )
       VALUES (1, $1, $2, $3, $4, $5::time, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        defaults.is_enabled,
        defaults.email_enabled,
        defaults.whatsapp_enabled,
        defaults.timezone,
        defaults.send_time,
        defaults.recipient_email,
        defaults.recipient_phone,
        defaults.low_stock_threshold,
        defaults.include_out_of_stock,
        defaults.include_credit_summary,
        defaults.include_supplier_dues,
      ]
    );
    const result = await client.query(
      `SELECT id, is_enabled, email_enabled, whatsapp_enabled, timezone,
              to_char(send_time, 'HH24:MI') AS send_time,
              recipient_email, recipient_phone, low_stock_threshold,
              include_out_of_stock, include_credit_summary, include_supplier_dues,
              created_at, updated_at
       FROM owner_daily_digest_settings
       WHERE id = 1`
    );
    return result.rows[0];
  } finally {
    client.release();
  }
};

const updateSettings = async (requestPool, payload = {}, context = {}) => {
  const client = await requestPool.connect();
  try {
    await ensureOwnerDigestSchema(client);
    const contact = context.contact || {};
    await client.query(
      `INSERT INTO owner_daily_digest_settings (
          id, is_enabled, email_enabled, whatsapp_enabled, timezone, send_time,
          recipient_email, recipient_phone, low_stock_threshold, include_out_of_stock,
          include_credit_summary, include_supplier_dues
       )
       VALUES (1, TRUE, TRUE, TRUE, $1, $2::time, $3, $4, $5, TRUE, TRUE, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [
        sanitizeTimezone(context.timezone || DEFAULT_TIMEZONE),
        sanitizeTime(context.send_time || DEFAULT_DIGEST_TIME),
        String(contact.owner_email || context.recipient_email || '').trim() || null,
        normalizePhone(contact.owner_phone || context.recipient_phone || '') || null,
        DEFAULT_LOW_STOCK_THRESHOLD,
      ]
    );
    const existingRes = await client.query(
      `SELECT id, is_enabled, email_enabled, whatsapp_enabled, timezone,
              to_char(send_time, 'HH24:MI') AS send_time,
              recipient_email, recipient_phone, low_stock_threshold,
              include_out_of_stock, include_credit_summary, include_supplier_dues
       FROM owner_daily_digest_settings
       WHERE id = 1`
    );
    const existing = existingRes.rows[0];
    const next = {
      is_enabled: payload.is_enabled === undefined ? existing.is_enabled : toBool(payload.is_enabled),
      email_enabled:
        payload.email_enabled === undefined ? existing.email_enabled : toBool(payload.email_enabled),
      whatsapp_enabled:
        payload.whatsapp_enabled === undefined
          ? existing.whatsapp_enabled
          : toBool(payload.whatsapp_enabled),
      timezone: sanitizeTimezone(payload.timezone || existing.timezone),
      send_time: sanitizeTime(payload.send_time || existing.send_time),
      recipient_email:
        payload.recipient_email === undefined
          ? existing.recipient_email
          : String(payload.recipient_email || '').trim() || null,
      recipient_phone:
        payload.recipient_phone === undefined
          ? existing.recipient_phone
          : normalizePhone(payload.recipient_phone || '') || null,
      low_stock_threshold:
        payload.low_stock_threshold === undefined
          ? toNumber(existing.low_stock_threshold, DEFAULT_LOW_STOCK_THRESHOLD)
          : Math.max(1, toNumber(payload.low_stock_threshold, DEFAULT_LOW_STOCK_THRESHOLD)),
      include_out_of_stock:
        payload.include_out_of_stock === undefined
          ? existing.include_out_of_stock
          : toBool(payload.include_out_of_stock),
      include_credit_summary:
        payload.include_credit_summary === undefined
          ? existing.include_credit_summary
          : toBool(payload.include_credit_summary),
      include_supplier_dues:
        payload.include_supplier_dues === undefined
          ? existing.include_supplier_dues
          : toBool(payload.include_supplier_dues),
    };

    const updated = await client.query(
      `UPDATE owner_daily_digest_settings
       SET is_enabled = $1,
           email_enabled = $2,
           whatsapp_enabled = $3,
           timezone = $4,
           send_time = $5::time,
           recipient_email = $6,
           recipient_phone = $7,
           low_stock_threshold = $8,
           include_out_of_stock = $9,
           include_credit_summary = $10,
           include_supplier_dues = $11,
           updated_at = NOW()
       WHERE id = 1
       RETURNING id, is_enabled, email_enabled, whatsapp_enabled, timezone,
                 to_char(send_time, 'HH24:MI') AS send_time,
                 recipient_email, recipient_phone, low_stock_threshold,
                 include_out_of_stock, include_credit_summary, include_supplier_dues,
                 created_at, updated_at`,
      [
        next.is_enabled,
        next.email_enabled,
        next.whatsapp_enabled,
        next.timezone,
        next.send_time,
        next.recipient_email,
        next.recipient_phone,
        next.low_stock_threshold,
        next.include_out_of_stock,
        next.include_credit_summary,
        next.include_supplier_dues,
      ]
    );

    return updated.rows[0];
  } finally {
    client.release();
  }
};

const fetchDigestData = async (requestPool, options) => {
  const { reportDate, timezone, lowStockThreshold } = options;
  const salesParams = [reportDate, timezone, SALES_STATUSES];
  const lowStockParams = [lowStockThreshold];
  const cashFlowParams = [reportDate, timezone];
  const safeQuery = async (sql, queryParams, fallbackRows = []) => {
    try {
      return await requestPool.query(sql, queryParams);
    } catch (error) {
      if (error?.code === '42P01') {
        return { rows: fallbackRows };
      }
      throw error;
    }
  };

  const salesPromise = safeQuery(
    `WITH day_bounds AS (
       SELECT ($1::date::timestamp AT TIME ZONE $2) AS start_utc,
              (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE $2) AS end_utc
     )
     SELECT
       COALESCE(SUM(o.total_price - COALESCE(o.returned_amount, 0)), 0)::numeric AS total_revenue,
       COUNT(*)::int AS total_orders,
       COALESCE(SUM(
         GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
         * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))
       ), 0)::numeric AS total_profit
     FROM day_bounds d
     JOIN orders o ON o.created_at >= d.start_utc AND o.created_at < d.end_utc
     LEFT JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN (
       SELECT rr.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
       FROM order_returns rr
       JOIN order_return_items ori ON ori.return_id = rr.id
       GROUP BY rr.order_id, ori.product_id
     ) r ON r.order_id = o.id AND r.product_id = oi.product_id
     WHERE o.order_status = ANY($3::text[])
       AND o.transaction_type = 'sale'`,
    salesParams
  );

  const lowStockPromise = safeQuery(
    `SELECT p.id, p.name, p.stock_quantity
     FROM products p
     WHERE COALESCE((to_jsonb(p)->>'is_deleted')::boolean, FALSE) = FALSE
       AND p.stock_quantity > 0
       AND p.stock_quantity <= $1
     ORDER BY stock_quantity ASC, id ASC
     LIMIT 20`,
    lowStockParams
  );

  const outStockPromise = safeQuery(
    `SELECT COUNT(*)::int AS out_of_stock_count
     FROM products p
     WHERE COALESCE((to_jsonb(p)->>'is_deleted')::boolean, FALSE) = FALSE
       AND p.stock_quantity <= 0`
  );

  const customerOutstandingPromise = safeQuery(
    `SELECT COALESCE(SUM(current_balance), 0)::numeric AS total_customer_outstanding
     FROM customers c
     WHERE COALESCE((to_jsonb(c)->>'is_deleted')::boolean, FALSE) = FALSE`
  );

  const topCustomerPromise = safeQuery(
    `SELECT c.id, c.name, COALESCE(c.current_balance, 0)::numeric AS current_balance
     FROM customers c
     WHERE COALESCE((to_jsonb(c)->>'is_deleted')::boolean, FALSE) = FALSE
       AND COALESCE(c.current_balance, 0) > 0
     ORDER BY current_balance DESC
     LIMIT 5`
  );

  const supplierOutstandingPromise = safeQuery(
    `SELECT COALESCE(SUM(current_balance), 0)::numeric AS total_supplier_outstanding
     FROM suppliers s
     WHERE COALESCE((to_jsonb(s)->>'is_deleted')::boolean, FALSE) = FALSE`
  );

  const topSupplierPromise = safeQuery(
    `SELECT s.id, s.name, COALESCE(s.current_balance, 0)::numeric AS current_balance
     FROM suppliers s
     WHERE COALESCE((to_jsonb(s)->>'is_deleted')::boolean, FALSE) = FALSE
       AND COALESCE(s.current_balance, 0) > 0
     ORDER BY current_balance DESC
     LIMIT 5`
  );

  const cashFlowPromise = safeQuery(
    `WITH day_bounds AS (
       SELECT ($1::date::timestamp AT TIME ZONE $2) AS start_utc,
              (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE $2) AS end_utc
     )
     SELECT
       COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0)::numeric AS day_credit_in,
       COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)::numeric AS day_debit_out
     FROM day_bounds d
     JOIN transactions t ON t.created_at >= d.start_utc AND t.created_at < d.end_utc`,
    cashFlowParams,
    [{ day_credit_in: 0, day_debit_out: 0 }]
  );

  const [
    salesRes,
    lowStockRes,
    outStockRes,
    customerOutstandingRes,
    topCustomerRes,
    supplierOutstandingRes,
    topSupplierRes,
    cashFlowRes,
  ] = await Promise.all([
    salesPromise,
    lowStockPromise,
    outStockPromise,
    customerOutstandingPromise,
    topCustomerPromise,
    supplierOutstandingPromise,
    topSupplierPromise,
    cashFlowPromise,
  ]);

  return {
    report_date: reportDate,
    sales: {
      total_revenue: toNumber(salesRes.rows[0]?.total_revenue),
      total_orders: toNumber(salesRes.rows[0]?.total_orders),
      total_profit: toNumber(salesRes.rows[0]?.total_profit),
    },
    stock: {
      threshold: lowStockThreshold,
      low_stock: lowStockRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        stock_quantity: toNumber(row.stock_quantity),
      })),
      out_of_stock_count: toNumber(outStockRes.rows[0]?.out_of_stock_count),
    },
    accounts: {
      cash_in: toNumber(cashFlowRes.rows[0]?.day_credit_in),
      cash_out: toNumber(cashFlowRes.rows[0]?.day_debit_out),
      customer_outstanding: toNumber(customerOutstandingRes.rows[0]?.total_customer_outstanding),
      supplier_outstanding: toNumber(supplierOutstandingRes.rows[0]?.total_supplier_outstanding),
      top_customer_dues: topCustomerRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        amount: toNumber(row.current_balance),
      })),
      top_supplier_dues: topSupplierRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        amount: toNumber(row.current_balance),
      })),
    },
  };
};

const buildDigestText = ({ shopName, ownerName, digest, settings }) => {
  const lines = [];
  lines.push(`Daily Report | ${shopName || 'Your Store'} | ${digest.report_date}`);
  if (ownerName) {
    lines.push(`Owner: ${ownerName}`);
  }
  lines.push('');
  lines.push('Sales Summary');
  lines.push(`- Orders: ${digest.sales.total_orders}`);
  lines.push(`- Revenue: ${formatMoney(digest.sales.total_revenue)}`);
  lines.push(`- Profit: ${formatMoney(digest.sales.total_profit)}`);
  lines.push('');
  lines.push('Stock Summary');
  lines.push(
    `- Low Stock (<= ${settings.low_stock_threshold}): ${digest.stock.low_stock.length} items`
  );
  if (settings.include_out_of_stock) {
    lines.push(`- Out of Stock: ${digest.stock.out_of_stock_count} items`);
  }
  if (digest.stock.low_stock.length > 0) {
    lines.push('- Critical Items:');
    digest.stock.low_stock.slice(0, 8).forEach((row) => {
      lines.push(`  * ${row.name} (${row.stock_quantity})`);
    });
  }
  lines.push('');
  lines.push('Debit / Credit');
  lines.push(`- Cash In: ${formatMoney(digest.accounts.cash_in)}`);
  lines.push(`- Cash Out: ${formatMoney(digest.accounts.cash_out)}`);
  if (settings.include_credit_summary) {
    lines.push(`- Customer Credit Outstanding: ${formatMoney(digest.accounts.customer_outstanding)}`);
  }
  if (settings.include_supplier_dues) {
    lines.push(`- Supplier Dues Outstanding: ${formatMoney(digest.accounts.supplier_outstanding)}`);
  }
  return lines.join('\n');
};

const buildDigestHtml = ({ shopName, ownerName, digest, settings }) => {
  const lowStockRows =
    digest.stock.low_stock.length === 0
      ? '<tr><td colspan="2">No low-stock items today.</td></tr>'
      : digest.stock.low_stock
          .slice(0, 12)
          .map(
            (row) =>
              `<tr><td>${row.name}</td><td style="text-align:right;">${row.stock_quantity}</td></tr>`
          )
          .join('');
  const customerRows =
    digest.accounts.top_customer_dues.length === 0
      ? '<tr><td colspan="2">No customer dues.</td></tr>'
      : digest.accounts.top_customer_dues
          .map(
            (row) =>
              `<tr><td>${row.name}</td><td style="text-align:right;">${formatMoney(row.amount)}</td></tr>`
          )
          .join('');
  const supplierRows =
    digest.accounts.top_supplier_dues.length === 0
      ? '<tr><td colspan="2">No supplier dues.</td></tr>'
      : digest.accounts.top_supplier_dues
          .map(
            (row) =>
              `<tr><td>${row.name}</td><td style="text-align:right;">${formatMoney(row.amount)}</td></tr>`
          )
          .join('');

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.45;">
    <h2 style="margin:0 0 8px;">Daily Owner Report - ${shopName || 'Your Store'}</h2>
    <div style="margin-bottom:12px;">Date: <strong>${digest.report_date}</strong>${ownerName ? ` | Owner: <strong>${ownerName}</strong>` : ''}</div>
    <h3>Sales Summary</h3>
    <ul>
      <li>Orders: <strong>${digest.sales.total_orders}</strong></li>
      <li>Revenue: <strong>${formatMoney(digest.sales.total_revenue)}</strong></li>
      <li>Profit: <strong>${formatMoney(digest.sales.total_profit)}</strong></li>
    </ul>
    <h3>Stock Summary</h3>
    <ul>
      <li>Low Stock (<= ${settings.low_stock_threshold}): <strong>${digest.stock.low_stock.length}</strong></li>
      ${
        settings.include_out_of_stock
          ? `<li>Out of Stock: <strong>${digest.stock.out_of_stock_count}</strong></li>`
          : ''
      }
    </ul>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;min-width:420px;">
      <thead><tr><th align="left">Low Stock Item</th><th align="right">Qty</th></tr></thead>
      <tbody>${lowStockRows}</tbody>
    </table>
    <h3 style="margin-top:16px;">Debit / Credit Summary</h3>
    <ul>
      <li>Cash In: <strong>${formatMoney(digest.accounts.cash_in)}</strong></li>
      <li>Cash Out: <strong>${formatMoney(digest.accounts.cash_out)}</strong></li>
      ${
        settings.include_credit_summary
          ? `<li>Customer Credit Outstanding: <strong>${formatMoney(
              digest.accounts.customer_outstanding
            )}</strong></li>`
          : ''
      }
      ${
        settings.include_supplier_dues
          ? `<li>Supplier Dues Outstanding: <strong>${formatMoney(
              digest.accounts.supplier_outstanding
            )}</strong></li>`
          : ''
      }
    </ul>
    ${
      settings.include_credit_summary
        ? `<h4>Top Customer Dues</h4>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;min-width:420px;">
        <thead><tr><th align="left">Customer</th><th align="right">Amount</th></tr></thead>
        <tbody>${customerRows}</tbody>
      </table>`
        : ''
    }
    ${
      settings.include_supplier_dues
        ? `<h4 style="margin-top:14px;">Top Supplier Dues</h4>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;min-width:420px;">
        <thead><tr><th align="left">Supplier</th><th align="right">Amount</th></tr></thead>
        <tbody>${supplierRows}</tbody>
      </table>`
        : ''
    }
  </div>`;
};

const getSmtpTransporter = () => {
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
    auth: { user, pass },
  });
};

const claimDelivery = async (client, reportDate, channel) => {
  const result = await client.query(
    `INSERT INTO owner_daily_digest_deliveries (report_date, channel, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (report_date, channel) DO NOTHING
     RETURNING id`,
    [reportDate, channel]
  );
  return result.rows[0]?.id || null;
};

const completeDelivery = async (client, id, payload, recipient) => {
  await client.query(
    `UPDATE owner_daily_digest_deliveries
     SET status = 'sent',
         payload = $2,
         recipient = $3,
         sent_at = NOW()
     WHERE id = $1`,
    [id, payload, recipient]
  );
};

const failDelivery = async (client, id, errorMessage) => {
  await client.query(
    `UPDATE owner_daily_digest_deliveries
     SET status = 'failed',
         error_message = LEFT($2, 1200)
     WHERE id = $1`,
    [id, String(errorMessage || 'Failed')]
  );
};

const sendDigestToChannels = async ({ requestPool, settings, digest, shopName, ownerName, forceSend = false }) => {
  const text = buildDigestText({ shopName, ownerName, digest, settings });
  const html = buildDigestHtml({ shopName, ownerName, digest, settings });
  const subject = `Daily Report - ${shopName || 'Store'} - ${digest.report_date}`;
  const channels = [];
  const client = await requestPool.connect();
  try {
    await ensureOwnerDigestSchema(client);

    if (settings.email_enabled && settings.recipient_email) {
      let deliveryId = null;
      if (!forceSend) {
        deliveryId = await claimDelivery(client, digest.report_date, 'email');
      }
      if (forceSend || deliveryId) {
        try {
          const transporter = getSmtpTransporter();
          await transporter.sendMail({
            to: settings.recipient_email,
            subject,
            html,
            text,
          });
          if (deliveryId) {
            await completeDelivery(client, deliveryId, subject, settings.recipient_email);
          }
          channels.push({ channel: 'email', status: 'sent', recipient: settings.recipient_email });
        } catch (error) {
          if (deliveryId) {
            await failDelivery(client, deliveryId, error.message || 'Email failed');
          }
          channels.push({
            channel: 'email',
            status: 'failed',
            recipient: settings.recipient_email,
            error: error.message || 'Email failed',
          });
        }
      }
    }

    if (settings.whatsapp_enabled && settings.recipient_phone) {
      let deliveryId = null;
      if (!forceSend) {
        deliveryId = await claimDelivery(client, digest.report_date, 'whatsapp');
      }
      if (forceSend || deliveryId) {
        try {
          await whatsappService.sendText(
            { tenantPool: requestPool },
            {
              phone: settings.recipient_phone,
              message: text,
            },
            { requestPool, skipModuleCheck: false }
          );
          if (deliveryId) {
            await completeDelivery(client, deliveryId, subject, settings.recipient_phone);
          }
          channels.push({ channel: 'whatsapp', status: 'sent', recipient: settings.recipient_phone });
        } catch (error) {
          if (deliveryId) {
            await failDelivery(client, deliveryId, error.message || 'WhatsApp failed');
          }
          channels.push({
            channel: 'whatsapp',
            status: 'failed',
            recipient: settings.recipient_phone,
            error: error.message || 'WhatsApp failed',
          });
        }
      }
    }
  } finally {
    client.release();
  }
  return { subject, text, html, channels };
};

const buildDigestPreview = async (requestPool, options = {}) => {
  const timezone = sanitizeTimezone(options.timezone || DEFAULT_TIMEZONE);
  const reportDate = options.report_date || shiftDateText(getLocalParts(new Date(), timezone).date, -1);
  const lowStockThreshold = Math.max(
    1,
    toNumber(options.low_stock_threshold, DEFAULT_LOW_STOCK_THRESHOLD)
  );
  const digest = await fetchDigestData(requestPool, { reportDate, timezone, lowStockThreshold });
  return digest;
};

const executeDigestForTenant = async ({
  tenantId,
  requestPool,
  contact,
  forceSend = false,
  overrides = null,
}) => {
  const settings = await getSettings(requestPool, { contact });
  const mergedSettings = {
    ...settings,
    ...(overrides || {}),
  };
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, 'recipient_email')) {
    mergedSettings.recipient_email = String(overrides.recipient_email || '').trim() || null;
  }
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, 'recipient_phone')) {
    mergedSettings.recipient_phone = normalizePhone(overrides.recipient_phone || '') || null;
  }
  if (!settings.is_enabled && !forceSend) {
    return { status: 'disabled', settings };
  }

  const timezone = sanitizeTimezone(mergedSettings.timezone || DEFAULT_TIMEZONE);
  const nowLocal = getLocalParts(new Date(), timezone);
  const reportDate = shiftDateText(nowLocal.date, -1);
  const nowMinutes = nowLocal.hour * 60 + nowLocal.minute;
  const scheduleMinutes = parseMinutes(mergedSettings.send_time);

  if (!forceSend && nowMinutes < scheduleMinutes) {
    return {
      status: 'not_due',
      reason: 'before_scheduled_time',
      local_now: `${String(nowLocal.hour).padStart(2, '0')}:${String(nowLocal.minute).padStart(2, '0')}`,
      send_time: mergedSettings.send_time,
      timezone,
      report_date: reportDate,
    };
  }

  const digest = await fetchDigestData(requestPool, {
    reportDate,
    timezone,
    lowStockThreshold: toNumber(mergedSettings.low_stock_threshold, DEFAULT_LOW_STOCK_THRESHOLD),
  });

  const delivery = await sendDigestToChannels({
    requestPool,
    settings: mergedSettings,
    digest,
    shopName: contact.shop_name || null,
    ownerName: contact.owner_name || null,
    forceSend,
  });

  return {
    status: 'processed',
    tenant_id: tenantId || null,
    report_date: reportDate,
    timezone,
    settings: mergedSettings,
    digest,
    delivery: delivery.channels,
  };
};

const runOwnerDigestForTenantById = async (tenantId, options = {}) => {
  const tenantRes = await masterPool.query(
    `SELECT id, shop_name, owner_name, email, mobile, database_name
     FROM tenants
     WHERE id = $1`,
    [tenantId]
  );
  if (tenantRes.rowCount === 0) {
    const err = new Error('Tenant not found');
    err.status = 404;
    throw err;
  }
  const tenant = tenantRes.rows[0];
  const pool = getTenantPool(tenant.database_name);
  return executeDigestForTenant({
    tenantId: tenant.id,
    requestPool: pool,
    contact: {
      shop_name: tenant.shop_name,
      owner_name: tenant.owner_name,
      owner_email: tenant.email,
      owner_phone: tenant.mobile,
    },
    forceSend: options.forceSend === true,
    overrides: options.overrides || null,
  });
};

const runOwnerDigestForAllActiveTenants = async () => {
  const tenantsRes = await masterPool.query(
    `SELECT id, shop_name, owner_name, email, mobile, database_name
     FROM tenants
     WHERE is_active = TRUE
       AND database_name IS NOT NULL
     ORDER BY id ASC`
  );
  const summary = {
    total_tenants: tenantsRes.rowCount,
    processed_tenants: 0,
    failed_tenants: 0,
    results: [],
  };

  for (const tenant of tenantsRes.rows) {
    try {
      const pool = getTenantPool(tenant.database_name);
      const result = await executeDigestForTenant({
        tenantId: tenant.id,
        requestPool: pool,
        contact: {
          shop_name: tenant.shop_name,
          owner_name: tenant.owner_name,
          owner_email: tenant.email,
          owner_phone: tenant.mobile,
        },
        forceSend: false,
      });
      summary.processed_tenants += 1;
      summary.results.push({
        tenant_id: tenant.id,
        status: result.status,
        report_date: result.report_date || null,
      });
    } catch (error) {
      summary.failed_tenants += 1;
      summary.results.push({
        tenant_id: tenant.id,
        status: 'failed',
        error: error.message || 'Failed',
      });
    }
  }
  return summary;
};

module.exports = {
  getTenantContact,
  getSettings,
  updateSettings,
  buildDigestPreview,
  runOwnerDigestForTenantById,
  runOwnerDigestForAllActiveTenants,
};
