const pool = require('../db');

const getRequestPool = (req) => req.tenantPool || req.pool || pool;

const ensureSettingsRow = async (requestPool) => {
  const existing = await requestPool.query(
    'SELECT id, whatsapp_bill_module, COALESCE(is_opening_completed, FALSE) AS is_opening_completed FROM settings ORDER BY id ASC LIMIT 1'
  );
  if (existing.rowCount > 0) return existing.rows[0];

  const inserted = await requestPool.query(
    `INSERT INTO settings (whatsapp_bill_module, is_opening_completed)
     VALUES (FALSE, FALSE)
     RETURNING id, whatsapp_bill_module, COALESCE(is_opening_completed, FALSE) AS is_opening_completed`
  );
  return inserted.rows[0];
};

const getSettings = async (req) => {
  const requestPool = getRequestPool(req);
  if (!requestPool) {
    const err = new Error('Tenant database connection is not available');
    err.status = 500;
    throw err;
  }
  const row = await ensureSettingsRow(requestPool);
  return {
    whatsapp_bill_module: row?.whatsapp_bill_module === true,
    is_opening_completed: row?.is_opening_completed === true
  };
};

module.exports = {
  getSettings
};
