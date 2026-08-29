const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const parseUpdatedAfter = (raw) => {
  if (!raw) return null;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return undefined;
  return value.toISOString();
};

const buildResponse = (data, deletedIds, serverTime) => ({
  data,
  deleted_ids: deletedIds,
  server_time: serverTime,
});

const getServerTime = async (client) => {
  const res = await client.query(`SELECT (NOW() AT TIME ZONE 'UTC')::timestamp AS server_time`);
  return res.rows[0]?.server_time || new Date().toISOString();
};

const syncProducts = async (req, res) => {
  const requestPool = getRequestPool(req);
  const updatedAfter = parseUpdatedAfter(req.query?.updated_after || req.query?.updatedAfter);
  if (updatedAfter === undefined) {
    return res.status(400).json({ message: 'updated_after is invalid.' });
  }
  const branchId = resolveBranchIdFromRequest(req);
  const params = [];
  let idx = 1;
  const conditions = [];
  if (updatedAfter) {
    conditions.push(`p.updated_at > $${idx}`);
    params.push(updatedAfter);
    idx += 1;
  }
  if (branchId) {
    conditions.push(`(p.branch_id = $${idx} OR p.branch_id IS NULL)`);
    params.push(branchId);
    idx += 1;
  }
  const whereBase = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const dataQuery = `
    WITH active_batch_expiry AS (
      SELECT product_id,
             MIN(expiry_date) FILTER (WHERE expiry_date IS NOT NULL) AS nearest_expiry_date
      FROM batches
      WHERE is_deleted = FALSE
        AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        ${branchId ? `AND (branch_id = $${idx - 1} OR branch_id IS NULL)` : ''}
      GROUP BY product_id
    )
    SELECT p.*,
           COALESCE(abe.nearest_expiry_date, p.expiry_date) AS expiry_date,
           abe.nearest_expiry_date
    FROM products p
    LEFT JOIN active_batch_expiry abe ON abe.product_id = p.id
    ${whereBase}${whereBase ? ' AND ' : ' WHERE '}p.is_deleted = FALSE
    ORDER BY p.updated_at ASC
  `;
  const deletedQuery = `
    SELECT p.id
    FROM products p
    ${whereBase}${whereBase ? ' AND ' : ' WHERE '}p.is_deleted = TRUE
    ORDER BY p.updated_at ASC
  `;
  const client = await requestPool.connect();
  try {
    const [dataRes, deletedRes, serverTime] = await Promise.all([
      client.query(dataQuery, params),
      client.query(deletedQuery, params),
      getServerTime(client),
    ]);
    return res.json(buildResponse(dataRes.rows, deletedRes.rows.map((row) => row.id), serverTime));
  } catch (error) {
    console.error('[syncProducts] failed', error);
    return res.status(500).json({
      message: 'Failed to sync products.',
      error: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  } finally {
    client.release();
  }
};

const syncBatches = async (req, res) => {
  const requestPool = getRequestPool(req);
  const updatedAfter = parseUpdatedAfter(req.query?.updated_after || req.query?.updatedAfter);
  if (updatedAfter === undefined) {
    return res.status(400).json({ message: 'updated_after is invalid.' });
  }
  const branchId = resolveBranchIdFromRequest(req);
  const params = [];
  let idx = 1;
  const conditions = [];
  if (updatedAfter) {
    conditions.push(`updated_at > $${idx}`);
    params.push(updatedAfter);
    idx += 1;
  }
  if (branchId) {
    conditions.push(`branch_id = $${idx}`);
    params.push(branchId);
    idx += 1;
  }
  const whereBase = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const dataQuery = `
    SELECT *
    FROM batches
    ${whereBase}${whereBase ? ' AND ' : ' WHERE '}is_deleted = FALSE
    ORDER BY updated_at ASC
  `;
  const deletedQuery = `
    SELECT id
    FROM batches
    ${whereBase}${whereBase ? ' AND ' : ' WHERE '}is_deleted = TRUE
    ORDER BY updated_at ASC
  `;
  const client = await requestPool.connect();
  try {
    const [dataRes, deletedRes, serverTime] = await Promise.all([
      client.query(dataQuery, params),
      client.query(deletedQuery, params),
      getServerTime(client),
    ]);
    return res.json(buildResponse(dataRes.rows, deletedRes.rows.map((row) => row.id), serverTime));
  } catch (error) {
    console.error('[syncBatches] failed', error);
    return res.status(500).json({
      message: 'Failed to sync batches.',
      error: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  } finally {
    client.release();
  }
};

const syncSuppliers = async (req, res) => {
  const requestPool = getRequestPool(req);
  const updatedAfter = parseUpdatedAfter(req.query?.updated_after || req.query?.updatedAfter);
  if (updatedAfter === undefined) {
    return res.status(400).json({ message: 'updated_after is invalid.' });
  }
  const branchId = resolveBranchIdFromRequest(req);
  const params = [];
  let idx = 1;
  const conditions = [];
  if (updatedAfter) {
    conditions.push(`updated_at > $${idx}`);
    params.push(updatedAfter);
    idx += 1;
  }
  if (branchId) {
    conditions.push(`(branch_id = $${idx} OR branch_id IS NULL)`);
    params.push(branchId);
    idx += 1;
  }
  const whereBase = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const dataQuery = `
    SELECT *
    FROM suppliers
    ${whereBase}${whereBase ? ' AND ' : ' WHERE '}is_deleted = FALSE
    ORDER BY updated_at ASC
  `;
  const deletedQuery = `
    SELECT id
    FROM suppliers
    ${whereBase}${whereBase ? ' AND ' : ' WHERE '}is_deleted = TRUE
    ORDER BY updated_at ASC
  `;
  const client = await requestPool.connect();
  try {
    const [dataRes, deletedRes, serverTime] = await Promise.all([
      client.query(dataQuery, params),
      client.query(deletedQuery, params),
      getServerTime(client),
    ]);
    return res.json(buildResponse(dataRes.rows, deletedRes.rows.map((row) => row.id), serverTime));
  } catch (error) {
    console.error('[syncSuppliers] failed', error);
    return res.status(500).json({
      message: 'Failed to sync suppliers.',
      error: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  } finally {
    client.release();
  }
};

module.exports = {
  syncProducts,
  syncBatches,
  syncSuppliers,
};
