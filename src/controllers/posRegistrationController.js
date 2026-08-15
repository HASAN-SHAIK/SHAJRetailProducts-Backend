const crypto = require('crypto');
const { resolveTenantContext } = require('../config/tenantDbResolver');
const { ensureDeviceRegistration } = require('../utils/branchDeviceLicensing');

const hashToken = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const newRequestId = () => `posreg_${crypto.randomUUID()}`;

const ensureTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_registration_requests (
      request_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      installation_id TEXT,
      device_name TEXT,
      os_info TEXT,
      request_token_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      branch_id TEXT,
      terminal_id TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewed_by TEXT,
      claimed_at TIMESTAMPTZ,
      CONSTRAINT pos_registration_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','CLAIMED'))
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_registration_requests_status ON pos_registration_requests(status, requested_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_registration_requests_device ON pos_registration_requests(device_id, requested_at DESC)`);
};

const publicTenantContext = async (req, res) => {
  const tenantId = String(req.get('X-POS-Tenant-ID') || req.body?.tenant_id || req.query?.tenant_id || '').trim();
  if (!tenantId) {
    res.status(400).json({ code: 'TENANT_ID_REQUIRED', message: 'X-POS-Tenant-ID is required' });
    return null;
  }
  const context = await resolveTenantContext(tenantId);
  if (!context || context.tenant?.is_active === false) {
    res.status(403).json({ code: 'TENANT_UNAVAILABLE', message: 'Tenant is unavailable' });
    return null;
  }
  return { tenantId, ...context };
};

const createRegistrationRequest = async (req, res, next) => {
  try {
    const context = await publicTenantContext(req, res);
    if (!context) return;
    const deviceId = String(req.body?.device_id || '').trim();
    if (!deviceId) return res.status(400).json({ code: 'DEVICE_ID_REQUIRED', message: 'device_id is required' });

    await ensureTable(context.tenantPool);
    const existing = await context.tenantPool.query(
      `SELECT request_id, status FROM pos_registration_requests
       WHERE device_id=$1 AND status IN ('PENDING','APPROVED')
       ORDER BY requested_at DESC LIMIT 1`,
      [deviceId]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({
        code: 'REGISTRATION_REQUEST_EXISTS',
        message: 'A registration request already exists for this device. Create a new request only after the existing request is completed or rejected.',
        request_id: existing.rows[0].request_id,
        status: existing.rows[0].status,
      });
    }

    const requestId = newRequestId();
    const requestToken = newToken();
    await context.tenantPool.query(
      `INSERT INTO pos_registration_requests
       (request_id, device_id, installation_id, device_name, os_info, request_token_hash)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        requestId,
        deviceId,
        String(req.body?.installation_id || '').trim() || null,
        String(req.body?.device_name || '').trim() || null,
        String(req.body?.os_info || '').trim() || null,
        hashToken(requestToken),
      ]
    );
    return res.status(201).json({ request_id: requestId, request_token: requestToken, status: 'PENDING' });
  } catch (error) { return next(error); }
};

const registrationStatus = async (req, res, next) => {
  try {
    const context = await publicTenantContext(req, res);
    if (!context) return;
    const requestId = String(req.params.requestId || '').trim();
    const requestToken = String(req.get('X-POS-Registration-Token') || req.query?.token || '').trim();
    if (!requestId || !requestToken) return res.status(401).json({ code: 'REGISTRATION_TOKEN_REQUIRED' });
    await ensureTable(context.tenantPool);
    const result = await context.tenantPool.query(
      `SELECT request_id, device_id, status, branch_id, terminal_id, requested_at, reviewed_at
       FROM pos_registration_requests WHERE request_id=$1 AND request_token_hash=$2`,
      [requestId, hashToken(requestToken)]
    );
    if (result.rowCount === 0) return res.status(404).json({ code: 'REGISTRATION_REQUEST_NOT_FOUND' });
    return res.json(result.rows[0]);
  } catch (error) { return next(error); }
};

const claimRegistration = async (req, res, next) => {
  try {
    const context = await publicTenantContext(req, res);
    if (!context) return;
    const requestId = String(req.params.requestId || '').trim();
    const requestToken = String(req.get('X-POS-Registration-Token') || req.body?.request_token || '').trim();
    await ensureTable(context.tenantPool);
    const result = await context.tenantPool.query(
      `UPDATE pos_registration_requests
       SET status='CLAIMED', claimed_at=NOW()
       WHERE request_id=$1 AND request_token_hash=$2 AND status='APPROVED'
       RETURNING request_id, device_id, branch_id, terminal_id, status`,
      [requestId, hashToken(requestToken)]
    );
    if (result.rowCount === 0) return res.status(409).json({ code: 'REGISTRATION_NOT_APPROVED', message: 'Registration is not ready to claim' });
    return res.json(result.rows[0]);
  } catch (error) { return next(error); }
};

const listRegistrationRequests = async (req, res, next) => {
  try {
    await ensureTable(req.tenantPool);
    const status = String(req.query?.status || '').trim().toUpperCase();
    const params = [];
    let where = '';
    if (status) { params.push(status); where = 'WHERE status=$1'; }
    const result = await req.tenantPool.query(
      `SELECT request_id, device_id, installation_id, device_name, os_info, status, branch_id, terminal_id, requested_at, reviewed_at, reviewed_by, claimed_at
       FROM pos_registration_requests ${where}
       ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, requested_at DESC`,
      params
    );
    return res.json({ requests: result.rows });
  } catch (error) { return next(error); }
};

const approveRegistrationRequest = async (req, res, next) => {
  try {
    const requestId = String(req.params.requestId || '').trim();
    const branchId = String(req.body?.branch_id || '').trim();
    const terminalId = String(req.body?.terminal_id || '').trim();
    if (!branchId || !terminalId) return res.status(400).json({ code: 'BRANCH_AND_TERMINAL_REQUIRED', message: 'branch_id and terminal_id are required' });
    await ensureTable(req.tenantPool);
    const pending = await req.tenantPool.query(
      `SELECT * FROM pos_registration_requests WHERE request_id=$1 AND status='PENDING'`,
      [requestId]
    );
    if (pending.rowCount === 0) return res.status(409).json({ code: 'REGISTRATION_NOT_PENDING' });
    const request = pending.rows[0];

    const terminalConflict = await req.tenantPool.query(
      `SELECT r.device_id
       FROM pos_registration_requests r
       JOIN branch_devices d
         ON d.device_id = r.device_id
        AND d.branch_id = r.branch_id
        AND d.is_active = TRUE
       WHERE r.branch_id = $1
         AND r.terminal_id = $2
         AND r.status IN ('APPROVED','CLAIMED')
         AND r.device_id <> $3
       ORDER BY COALESCE(r.claimed_at, r.reviewed_at, r.requested_at) DESC
       LIMIT 1`,
      [branchId, terminalId, request.device_id]
    );
    if (terminalConflict.rowCount > 0) {
      return res.status(409).json({
        code: 'TERMINAL_IN_USE',
        message: 'Terminal is assigned to another active POS device. Deactivate the previous device before approving a replacement.',
        terminal_id: terminalId,
        active_device_id: terminalConflict.rows[0].device_id,
      });
    }

    const registration = await ensureDeviceRegistration({
      tenantPool: req.tenantPool,
      branchId,
      deviceId: request.device_id,
      userId: req.user?.user_id || req.user?.id,
      mode: 'register',
      deviceInfo: { device_name: request.device_name, os_info: request.os_info },
    });
    if (!registration.allowed) {
      const status = registration.code === 'DEVICE_LIMIT_REACHED' ? 403 : 400;
      return res.status(status).json({ code: registration.code || 'DEVICE_REGISTRATION_FAILED', limit: registration.limit });
    }
    const updated = await req.tenantPool.query(
      `UPDATE pos_registration_requests
       SET status='APPROVED', branch_id=$2, terminal_id=$3, reviewed_at=NOW(), reviewed_by=$4
       WHERE request_id=$1
       RETURNING request_id, device_id, status, branch_id, terminal_id, reviewed_at`,
      [requestId, branchId, terminalId, String(req.user?.user_id || req.user?.id || '') || null]
    );
    return res.json(updated.rows[0]);
  } catch (error) { return next(error); }
};

const rejectRegistrationRequest = async (req, res, next) => {
  try {
    await ensureTable(req.tenantPool);
    const updated = await req.tenantPool.query(
      `UPDATE pos_registration_requests SET status='REJECTED', reviewed_at=NOW(), reviewed_by=$2
       WHERE request_id=$1 AND status='PENDING'
       RETURNING request_id, status, reviewed_at`,
      [String(req.params.requestId || '').trim(), String(req.user?.user_id || req.user?.id || '') || null]
    );
    if (updated.rowCount === 0) return res.status(409).json({ code: 'REGISTRATION_NOT_PENDING' });
    return res.json(updated.rows[0]);
  } catch (error) { return next(error); }
};

module.exports = {
  createRegistrationRequest,
  registrationStatus,
  claimRegistration,
  listRegistrationRequests,
  approveRegistrationRequest,
  rejectRegistrationRequest,
};