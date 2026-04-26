const nodemailer = require('nodemailer');
const masterPool = require('../config/masterDb');

const DEFAULT_INTAKE_EMAIL = 'shajnextgen@gmail.com';

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

const safeSendMail = async ({ to, subject, text, html }) => {
  if (!to) return { sent: false, reason: 'missing_recipient' };
  try {
    const transporter = buildTransporter();
    await transporter.sendMail({ to, subject, text, html });
    return { sent: true };
  } catch (error) {
    console.error('[SUPPORT_EMAIL] send failed:', error.message || error);
    return { sent: false, reason: error.message || 'send_failed' };
  }
};

const toLabel = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return raw
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const notifyNewSupportCase = async ({
  caseId,
  tenantId,
  title,
  description,
  category,
  priority,
  createdByName,
  createdByEmail
}) => {
  const intakeEmail = String(process.env.SUPPORT_CASE_INTAKE_EMAIL || DEFAULT_INTAKE_EMAIL).trim();
  const tenantRes = await masterPool.query(
    `SELECT id, shop_name, owner_name, email, mobile
     FROM tenants
     WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantRes.rows[0] || {};

  const subject = `[Support] New Case #${caseId} - ${title}`;
  const lines = [
    `A new support case was created.`,
    '',
    `Case ID: ${caseId}`,
    `Title: ${title || '-'}`,
    `Category: ${toLabel(category)}`,
    `Priority: ${toLabel(priority)}`,
    `Description: ${description || '-'}`,
    '',
    `Tenant ID: ${tenant.id || tenantId}`,
    `Shop: ${tenant.shop_name || '-'}`,
    `Tenant Owner: ${tenant.owner_name || '-'}`,
    `Tenant Email: ${tenant.email || '-'}`,
    `Tenant Mobile: ${tenant.mobile || '-'}`,
    '',
    `Created By: ${createdByName || '-'}`,
    `Creator Email: ${createdByEmail || '-'}`
  ];
  const text = lines.join('\n');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.45;color:#111827;">
      <h3>New Support Case Created</h3>
      <p><strong>Case ID:</strong> ${caseId}</p>
      <p><strong>Title:</strong> ${title || '-'}</p>
      <p><strong>Category:</strong> ${toLabel(category)}</p>
      <p><strong>Priority:</strong> ${toLabel(priority)}</p>
      <p><strong>Description:</strong><br/>${(description || '-').replace(/\n/g, '<br/>')}</p>
      <hr />
      <p><strong>Tenant ID:</strong> ${tenant.id || tenantId}</p>
      <p><strong>Shop:</strong> ${tenant.shop_name || '-'}</p>
      <p><strong>Tenant Owner:</strong> ${tenant.owner_name || '-'}</p>
      <p><strong>Tenant Email:</strong> ${tenant.email || '-'}</p>
      <p><strong>Tenant Mobile:</strong> ${tenant.mobile || '-'}</p>
      <hr />
      <p><strong>Created By:</strong> ${createdByName || '-'}</p>
      <p><strong>Creator Email:</strong> ${createdByEmail || '-'}</p>
    </div>
  `;
  return safeSendMail({ to: intakeEmail, subject, text, html });
};

const notifySupportAssigneeChanged = async ({
  caseId,
  title,
  category,
  priority,
  status,
  tenantId,
  tenantName,
  assigneeName,
  assigneeEmail
}) => {
  const subject = `[Support] Case #${caseId} Assigned to You`;
  const text = [
    `A support case has been assigned to you.`,
    '',
    `Case ID: ${caseId}`,
    `Title: ${title || '-'}`,
    `Category: ${toLabel(category)}`,
    `Priority: ${toLabel(priority)}`,
    `Status: ${toLabel(status)}`,
    `Tenant ID: ${tenantId || '-'}`,
    `Tenant: ${tenantName || '-'}`,
    '',
    `Assignee: ${assigneeName || '-'}`
  ].join('\n');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.45;color:#111827;">
      <h3>Support Case Assigned</h3>
      <p><strong>Case ID:</strong> ${caseId}</p>
      <p><strong>Title:</strong> ${title || '-'}</p>
      <p><strong>Category:</strong> ${toLabel(category)}</p>
      <p><strong>Priority:</strong> ${toLabel(priority)}</p>
      <p><strong>Status:</strong> ${toLabel(status)}</p>
      <p><strong>Tenant ID:</strong> ${tenantId || '-'}</p>
      <p><strong>Tenant:</strong> ${tenantName || '-'}</p>
      <p><strong>Assignee:</strong> ${assigneeName || '-'}</p>
    </div>
  `;
  return safeSendMail({ to: assigneeEmail, subject, text, html });
};

module.exports = {
  notifyNewSupportCase,
  notifySupportAssigneeChanged
};
