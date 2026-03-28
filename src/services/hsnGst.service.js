const pool = require('../db');

const getRequestPool = (req) => req.tenantPool || pool;

const normalizeHsn = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed || null;
};

const lookupGstByHsn = async (client, hsnCode) => {
  const normalized = normalizeHsn(hsnCode);
  if (!normalized) return null;
  const exact = await client.query(
    `SELECT gst_percentage, description, hsn_code
     FROM hsn_gst
     WHERE hsn_code = $1`,
    [normalized]
  );
  if (exact.rowCount > 0) {
    return exact.rows[0];
  }
  const prefix = await client.query(
    `SELECT gst_percentage, description, hsn_code
     FROM hsn_gst
     WHERE $1 LIKE hsn_code || '%'
     ORDER BY LENGTH(hsn_code) DESC
     LIMIT 1`,
    [normalized]
  );
  return prefix.rowCount > 0 ? prefix.rows[0] : null;
};

const resolveGstPercentage = async (req, hsnCode) => {
  const requestPool = getRequestPool(req);
  const row = await lookupGstByHsn(requestPool, hsnCode);
  if (!row) return null;
  const gst = Number(row.gst_percentage);
  return Number.isFinite(gst) ? gst : null;
};

const upsertHsnGst = async (client, hsnCode, gstPercentage, description = null) => {
  const normalized = normalizeHsn(hsnCode);
  if (!normalized || gstPercentage === null || gstPercentage === undefined) return;
  await client.query(
    `INSERT INTO hsn_gst (hsn_code, gst_percentage, description, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (hsn_code)
     DO UPDATE SET gst_percentage = EXCLUDED.gst_percentage,
                   description = COALESCE(EXCLUDED.description, hsn_gst.description),
                   updated_at = CURRENT_TIMESTAMP`,
    [normalized, gstPercentage, description]
  );
};

const searchHsn = async (req, query, limit = 20) => {
  const requestPool = getRequestPool(req);
  const search = String(query || '').trim();
  if (!search) return [];
  const like = `%${search}%`;
  const result = await requestPool.query(
    `SELECT hsn_code, gst_percentage, description
     FROM hsn_gst
     WHERE hsn_code ILIKE $1 OR description ILIKE $1
     ORDER BY LENGTH(hsn_code) ASC
     LIMIT $2`,
    [like, limit]
  );
  return result.rows;
};

module.exports = {
  lookupGstByHsn,
  resolveGstPercentage,
  upsertHsnGst,
  searchHsn
};
