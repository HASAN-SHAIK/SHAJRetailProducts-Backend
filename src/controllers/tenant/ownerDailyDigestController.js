const { jsonError, jsonOk } = require('../../utils/responses');
const ownerDailyDigestService = require('../../services/ownerDailyDigest.service');

const getContextContact = async (req) => {
  if (req.user?.tenant_id) {
    return ownerDailyDigestService.getTenantContact(req.user.tenant_id);
  }
  return {
    owner_name: req.user?.tenant_owner || null,
    owner_email: req.user?.tenant_email || null,
    owner_phone: req.user?.tenant_mobile || null,
    shop_name: req.user?.tenant_name || null,
  };
};

const getOwnerDailyDigestSettings = async (req, res) => {
  try {
    const contact = await getContextContact(req);
    const data = await ownerDailyDigestService.getSettings(req.tenantPool, { contact });
    return jsonOk(res, data);
  } catch (error) {
    return jsonError(
      res,
      error.status || 500,
      'OWNER_DIGEST_SETTINGS_FETCH_FAILED',
      error.message || 'Failed to load owner digest settings'
    );
  }
};

const updateOwnerDailyDigestSettings = async (req, res) => {
  try {
    const contact = await getContextContact(req);
    const data = await ownerDailyDigestService.updateSettings(req.tenantPool, req.body || {}, {
      contact,
    });
    return jsonOk(res, data);
  } catch (error) {
    return jsonError(
      res,
      error.status || 500,
      'OWNER_DIGEST_SETTINGS_UPDATE_FAILED',
      error.message || 'Failed to update owner digest settings'
    );
  }
};

const previewOwnerDailyDigest = async (req, res) => {
  try {
    const contact = await getContextContact(req);
    const settings = await ownerDailyDigestService.getSettings(req.tenantPool, { contact });
    const digest = await ownerDailyDigestService.buildDigestPreview(req.tenantPool, {
      report_date: req.query?.report_date,
      timezone: settings.timezone,
      low_stock_threshold: settings.low_stock_threshold,
    });
    return jsonOk(res, {
      settings,
      digest,
    });
  } catch (error) {
    return jsonError(
      res,
      error.status || 500,
      'OWNER_DIGEST_PREVIEW_FAILED',
      error.message || 'Failed to build digest preview'
    );
  }
};

const sendOwnerDailyDigestNow = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant context');
    }
    const result = await ownerDailyDigestService.runOwnerDigestForTenantById(tenantId, {
      forceSend: true,
    });
    return jsonOk(res, result);
  } catch (error) {
    return jsonError(
      res,
      error.status || 500,
      'OWNER_DIGEST_SEND_FAILED',
      error.message || 'Failed to send owner digest'
    );
  }
};

const sendOwnerDailyDigestTestEmail = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant context');
    }

    const recipientEmail = String(req.body?.recipient_email || '').trim().toLowerCase();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);
    if (!isValidEmail) {
      return jsonError(res, 400, 'INVALID_EMAIL', 'Please provide a valid recipient email');
    }

    const result = await ownerDailyDigestService.runOwnerDigestForTenantById(tenantId, {
      forceSend: true,
      overrides: {
        email_enabled: true,
        whatsapp_enabled: false,
        recipient_email: recipientEmail,
      },
    });

    const emailDelivery = Array.isArray(result?.delivery)
      ? result.delivery.find((item) => item?.channel === 'email')
      : null;
    if (!emailDelivery) {
      return jsonError(
        res,
        500,
        'OWNER_DIGEST_TEST_EMAIL_FAILED',
        'Email channel was not triggered for test send'
      );
    }
    if (emailDelivery.status !== 'sent') {
      return jsonError(
        res,
        500,
        'OWNER_DIGEST_TEST_EMAIL_FAILED',
        emailDelivery.error || 'SMTP send failed'
      );
    }
    return jsonOk(res, result);
  } catch (error) {
    return jsonError(
      res,
      error.status || 500,
      'OWNER_DIGEST_TEST_EMAIL_FAILED',
      error.message || 'Failed to send test email'
    );
  }
};

module.exports = {
  getOwnerDailyDigestSettings,
  updateOwnerDailyDigestSettings,
  previewOwnerDailyDigest,
  sendOwnerDailyDigestNow,
  sendOwnerDailyDigestTestEmail,
};
