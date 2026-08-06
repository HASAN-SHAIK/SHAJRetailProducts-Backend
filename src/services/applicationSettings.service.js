const pool = require('../db');
const masterPool = require('../db/masterPool');
const { getPermissionsForRole, getStorePermissions } = require('../utils/rolePermissions');

const getRequestPool = (req) => req.tenantPool || pool;

const SETTING_KEYS = {
  store: 'store_settings',
  tax: 'tax_settings',
  printer: 'printer_settings',
  theme: 'theme_settings',
};

const DEFAULTS = {
  store_settings: {
    invoice_prefix: 'INV',
    invoice_footer: 'Thank you for shopping with us.',
    currency: 'INR',
    auto_sync: true,
    notifications_enabled: true,
    biometric_lock: false,
  },
  tax_settings: {
    default_tax_percent: '18',
  },
  printer_settings: {
    receipt_paper_width_mm: 80,
  },
  theme_settings: {
    desktop: 'dark',
    mobile: 'dark',
  },
};

const ensureAppSettingsSchema = async (requestPool) => {
  await requestPool.query(
    `CREATE TABLE IF NOT EXISTS app_settings (
      id SERIAL PRIMARY KEY,
      setting_key VARCHAR(100) NOT NULL UNIQUE,
      value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
      updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
    )`
  );
};

const normalizeGstMode = (value) => {
  const mode = String(value || '').trim().toUpperCase();
  if (mode === 'INCLUSIVE' || mode === 'EXCLUSIVE') return mode;
  return null;
};

const readSettingGroup = async (requestPool, settingKey) => {
  const result = await requestPool.query(
    `SELECT value_json
     FROM app_settings
     WHERE setting_key = $1
     LIMIT 1`,
    [settingKey]
  );
  const stored = result.rows[0]?.value_json || {};
  return {
    ...(DEFAULTS[settingKey] || {}),
    ...(stored && typeof stored === 'object' ? stored : {}),
  };
};

const upsertSettingGroup = async (requestPool, settingKey, value) => {
  if (!value || typeof value !== 'object') return;
  const current = await readSettingGroup(requestPool, settingKey);
  const merged = { ...current, ...value };
  await requestPool.query(
    `INSERT INTO app_settings (setting_key, value_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (setting_key) DO UPDATE
     SET value_json = EXCLUDED.value_json,
         updated_at = NOW()`,
    [settingKey, JSON.stringify(merged)]
  );
};

const readCompanySettings = async (requestPool, tenant = {}) => {
  const result = await requestPool.query(
    `SELECT shop_name,
            owner_name,
            mobile_number,
            upi_id,
            gst_number,
            address_line,
            city,
            state,
            pincode
     FROM shop_details
     ORDER BY id ASC
     LIMIT 1`
  );
  if (result.rowCount > 0) {
    return result.rows[0];
  }
  return {
    shop_name: tenant.shop_name || null,
    owner_name: tenant.owner_name || null,
    mobile_number: tenant.mobile || null,
    upi_id: null,
    gst_number: null,
    address_line: null,
    city: null,
    state: null,
    pincode: null,
  };
};

const updateCompanySettings = async (requestPool, payload = {}, tenant = {}) => {
  const existing = await requestPool.query(`SELECT id FROM shop_details ORDER BY id ASC LIMIT 1`);
  const fields = {
    shop_name: payload.shop_name,
    owner_name: payload.owner_name,
    mobile_number: payload.mobile_number,
    upi_id: payload.upi_id,
    gst_number: payload.gst_number,
    address_line: payload.address_line,
    city: payload.city,
    state: payload.state,
    pincode: payload.pincode,
  };

  if (existing.rowCount === 0) {
    await requestPool.query(
      `INSERT INTO shop_details (shop_name, owner_name, mobile_number, upi_id, gst_number, address_line, city, state, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        fields.shop_name ?? tenant.shop_name ?? null,
        fields.owner_name ?? tenant.owner_name ?? null,
        fields.mobile_number ?? tenant.mobile ?? null,
        fields.upi_id ?? null,
        fields.gst_number ?? null,
        fields.address_line ?? null,
        fields.city ?? null,
        fields.state ?? null,
        fields.pincode ?? null,
      ]
    );
    return readCompanySettings(requestPool, tenant);
  }

  const updates = [];
  const values = [];
  Object.entries(fields).forEach(([field, value]) => {
    if (value !== undefined) {
      values.push(value);
      updates.push(`${field} = $${values.length}`);
    }
  });
  if (!updates.length) return readCompanySettings(requestPool, tenant);
  values.push(existing.rows[0].id);
  await requestPool.query(
    `UPDATE shop_details SET ${updates.join(', ')} WHERE id = $${values.length}`,
    values
  );
  return readCompanySettings(requestPool, tenant);
};

const updateTenantGstMode = async (tenantId, gstMode) => {
  if (!tenantId || !gstMode) return null;
  try {
    const result = await masterPool.query(
      `UPDATE tenants
       SET gst_mode = $2
       WHERE id = $1
       RETURNING gst_mode`,
      [tenantId, gstMode]
    );
    return result.rows[0]?.gst_mode || gstMode;
  } catch (error) {
    if (error?.code !== '42703') throw error;
    return gstMode;
  }
};

const getApplicationSettings = async (req) => {
  const requestPool = getRequestPool(req);
  await ensureAppSettingsSchema(requestPool);
  const tenant = req.tenant || {};
  const [store, taxSettings, printer, theme, company] = await Promise.all([
    readSettingGroup(requestPool, SETTING_KEYS.store),
    readSettingGroup(requestPool, SETTING_KEYS.tax),
    readSettingGroup(requestPool, SETTING_KEYS.printer),
    readSettingGroup(requestPool, SETTING_KEYS.theme),
    readCompanySettings(requestPool, tenant),
  ]);

  return {
    store,
    tax: {
      ...taxSettings,
      gst_mode: tenant.gst_mode || 'INCLUSIVE',
    },
    printer,
    theme,
    permissions: {
      role: req.user?.role || null,
      permissions: getPermissionsForRole(req.user?.role),
      store_permissions: getStorePermissions(req.user || {}),
    },
    company,
  };
};

const updateApplicationSettings = async (req, payload = {}) => {
  const requestPool = getRequestPool(req);
  await ensureAppSettingsSchema(requestPool);
  const tenant = req.tenant || {};
  const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';

  if (payload.store && typeof payload.store === 'object') {
    await upsertSettingGroup(requestPool, SETTING_KEYS.store, payload.store);
  }
  if (payload.printer && typeof payload.printer === 'object') {
    await upsertSettingGroup(requestPool, SETTING_KEYS.printer, payload.printer);
  }
  if (payload.theme && typeof payload.theme === 'object') {
    await upsertSettingGroup(requestPool, SETTING_KEYS.theme, payload.theme);
  }
  if (payload.tax && typeof payload.tax === 'object') {
    const taxPayload = { ...payload.tax };
    if (taxPayload.gst_mode !== undefined) {
      const resolved = normalizeGstMode(taxPayload.gst_mode);
      if (!resolved) {
        const err = new Error('gst_mode must be INCLUSIVE or EXCLUSIVE.');
        err.status = 400;
        throw err;
      }
      if (!isAdmin) {
        const err = new Error('Only admin can update tax mode.');
        err.status = 403;
        throw err;
      }
      await updateTenantGstMode(tenant.id, resolved);
      delete taxPayload.gst_mode;
    }
    if (Object.keys(taxPayload).length) {
      await upsertSettingGroup(requestPool, SETTING_KEYS.tax, taxPayload);
    }
  }
  if (payload.company && typeof payload.company === 'object') {
    if (!isAdmin) {
      const err = new Error('Only admin can update company information.');
      err.status = 403;
      throw err;
    }
    await updateCompanySettings(requestPool, payload.company, tenant);
  }

  return getApplicationSettings(req);
};

module.exports = {
  getApplicationSettings,
  updateApplicationSettings,
};
