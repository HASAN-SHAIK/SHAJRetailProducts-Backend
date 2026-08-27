const crypto = require('crypto');
const { resolveTenantContext } = require('../config/tenantDbResolver');
const { ensureDeviceRegistration } = require('../utils/branchDeviceLicensing');

const hashToken = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const newRequestId = () => `posreg_${crypto.randomUUID()}`;
const normalizeSetupCode = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const normalizeCode = (value) => String(value || '').trim().toUpperCase();
const encodeTenantId = (tenantId) => Buffer.from(String(tenantId || ''), 'utf8').toString('hex').toUpperCase();
const decodeTenantId = (encoded) => Buffer.from(String(encoded || ''), 'hex').toString('utf8');
const newSetupCode = (tenantId) => `${encodeTenantId(tenantId)}.${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const ensureTable = async (pool) => {
  await pool.query(`CREATE TABLE IF NOT EXISTS pos_registration_requests (
    request_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, installation_id TEXT, device_name TEXT, os_info TEXT,
    request_token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', branch_id TEXT, terminal_id TEXT,
    store_number TEXT, pos_no TEXT, touchpoint_id TEXT, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ, reviewed_by TEXT, claimed_at TIMESTAMPTZ,
    CONSTRAINT pos_registration_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','CLAIMED')))`);
  await pool.query(`ALTER TABLE pos_registration_requests ADD COLUMN IF NOT EXISTS setup_code_hash TEXT`);
  await pool.query(`ALTER TABLE pos_registration_requests ADD COLUMN IF NOT EXISTS setup_code_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pos_registration_requests ADD COLUMN IF NOT EXISTS store_number TEXT`);
  await pool.query(`ALTER TABLE pos_registration_requests ADD COLUMN IF NOT EXISTS pos_no TEXT`);
  await pool.query(`ALTER TABLE pos_registration_requests ADD COLUMN IF NOT EXISTS touchpoint_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_registration_requests_status ON pos_registration_requests(status, requested_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_registration_requests_device ON pos_registration_requests(device_id, requested_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_registration_requests_setup_code ON pos_registration_requests(setup_code_hash)`);
};

const publicTenantContext = async (req, res) => {
  const tenantId = String(req.get('X-POS-Tenant-ID') || req.body?.tenant_id || req.query?.tenant_id || '').trim();
  if (!tenantId) { res.status(400).json({ code: 'TENANT_ID_REQUIRED', message: 'X-POS-Tenant-ID is required' }); return null; }
  const context = await resolveTenantContext(tenantId);
  if (!context || context.tenant?.is_active === false) { res.status(403).json({ code: 'TENANT_UNAVAILABLE', message: 'Tenant is unavailable' }); return null; }
  return { tenantId, ...context };
};

const resolveBranchByStoreNumber = async (pool, storeNumber) => {
  const result = await pool.query(`SELECT id, store_number, is_active FROM branches WHERE UPPER(store_number)=UPPER($1) LIMIT 1`, [storeNumber]);
  return result.rows[0] || null;
};

const createRegistrationRequest = async (req, res, next) => {
  try {
    const context = await publicTenantContext(req, res); if (!context) return;
    const deviceId = String(req.body?.device_id || '').trim();
    const storeNumber = normalizeCode(req.body?.store_number);
    const posNo = normalizeCode(req.body?.pos_no);
    const touchpointId = normalizeCode(req.body?.touchpoint_id);
    if (!deviceId) return res.status(400).json({ code: 'DEVICE_ID_REQUIRED', message: 'device_id is required' });
    if (!storeNumber || !posNo || !touchpointId) return res.status(400).json({ code: 'POS_BUSINESS_IDENTITY_REQUIRED', message: 'store_number, pos_no and touchpoint_id are required' });
    await ensureTable(context.tenantPool);
    const branch = await resolveBranchByStoreNumber(context.tenantPool, storeNumber);
    if (!branch) return res.status(404).json({ code: 'STORE_NOT_FOUND', message: 'Store number was not found' });
    if (branch.is_active === false) return res.status(409).json({ code: 'STORE_INACTIVE', message: 'Store is inactive' });
    const active = await context.tenantPool.query(`SELECT branch_id,store_number,pos_no,touchpoint_id FROM branch_devices WHERE device_id=$1 AND is_active=TRUE ORDER BY created_at DESC LIMIT 1`, [deviceId]);
    if (active.rowCount) return res.status(409).json({ code: 'DEVICE_ALREADY_REGISTERED', message: 'This device is already registered', registration: active.rows[0] });
    const identityConflict = await context.tenantPool.query(`SELECT device_id FROM branch_devices WHERE UPPER(store_number)=$1 AND UPPER(pos_no)=$2 AND UPPER(touchpoint_id)=$3 AND is_active=TRUE LIMIT 1`, [storeNumber, posNo, touchpointId]);
    if (identityConflict.rowCount) return res.status(409).json({ code: 'POS_IDENTITY_IN_USE', message: 'Store/POS/touchpoint is already assigned to another active device', active_device_id: identityConflict.rows[0].device_id });
    const existing = await context.tenantPool.query(`SELECT request_id,status FROM pos_registration_requests WHERE device_id=$1 AND status IN ('PENDING','APPROVED') ORDER BY requested_at DESC LIMIT 1`, [deviceId]);
    if (existing.rowCount) return res.status(409).json({ code: 'REGISTRATION_REQUEST_EXISTS', request_id: existing.rows[0].request_id, status: existing.rows[0].status });
    const requestId = newRequestId(); const requestToken = newToken();
    await context.tenantPool.query(`INSERT INTO pos_registration_requests (request_id,device_id,installation_id,device_name,os_info,request_token_hash,branch_id,store_number,pos_no,touchpoint_id,terminal_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9)`, [requestId,deviceId,String(req.body?.installation_id||'').trim()||null,String(req.body?.device_name||'').trim()||null,String(req.body?.os_info||'').trim()||null,hashToken(requestToken),String(branch.id),storeNumber,posNo,touchpointId]);
    return res.status(201).json({ request_id:requestId, request_token:requestToken, status:'PENDING', branch_id:branch.id, store_number:storeNumber, pos_no:posNo, touchpoint_id:touchpointId });
  } catch (error) { return next(error); }
};

const registrationStatus = async (req,res,next) => { try { const context=await publicTenantContext(req,res); if(!context)return; const requestId=String(req.params.requestId||'').trim(); const requestToken=String(req.get('X-POS-Registration-Token')||req.query?.token||'').trim(); if(!requestId||!requestToken)return res.status(401).json({code:'REGISTRATION_TOKEN_REQUIRED'}); await ensureTable(context.tenantPool); const result=await context.tenantPool.query(`SELECT request_id,device_id,status,branch_id,store_number,pos_no,touchpoint_id,terminal_id,requested_at,reviewed_at FROM pos_registration_requests WHERE request_id=$1 AND request_token_hash=$2`,[requestId,hashToken(requestToken)]); if(!result.rowCount)return res.status(404).json({code:'REGISTRATION_REQUEST_NOT_FOUND'}); return res.json(result.rows[0]); } catch(error){return next(error);} };

const claimRegistration = async (req,res,next) => { try { const context=await publicTenantContext(req,res); if(!context)return; const requestId=String(req.params.requestId||'').trim(); const requestToken=String(req.get('X-POS-Registration-Token')||req.body?.request_token||'').trim(); await ensureTable(context.tenantPool); const result=await context.tenantPool.query(`UPDATE pos_registration_requests SET status='CLAIMED',claimed_at=NOW() WHERE request_id=$1 AND request_token_hash=$2 AND status='APPROVED' RETURNING request_id,device_id,branch_id,store_number,pos_no,touchpoint_id,terminal_id,status`,[requestId,hashToken(requestToken)]); if(!result.rowCount)return res.status(409).json({code:'REGISTRATION_NOT_APPROVED'}); return res.json(result.rows[0]); } catch(error){return next(error);} };

const createSetupCode = async (req,res,next) => { try { const branchId=String(req.body?.branch_id||'').trim(); const posNo=normalizeCode(req.body?.pos_no||req.body?.terminal_id); const touchpointId=normalizeCode(req.body?.touchpoint_id); if(!branchId||!posNo||!touchpointId)return res.status(400).json({code:'POS_BUSINESS_IDENTITY_REQUIRED',message:'branch_id, pos_no and touchpoint_id are required'}); const branchRes=await req.tenantPool.query(`SELECT id,store_number FROM branches WHERE id::text=$1`,[branchId]); if(!branchRes.rowCount||!branchRes.rows[0].store_number)return res.status(400).json({code:'STORE_NUMBER_REQUIRED'}); await ensureTable(req.tenantPool); const requestId=newRequestId(),requestToken=newToken(),setupCode=newSetupCode(req.user?.tenant_id||req.tenant?.id),expiresAt=new Date(Date.now()+15*60*1000); const storeNumber=normalizeCode(branchRes.rows[0].store_number); await req.tenantPool.query(`INSERT INTO pos_registration_requests (request_id,device_id,device_name,request_token_hash,setup_code_hash,setup_code_expires_at,status,branch_id,store_number,pos_no,touchpoint_id,terminal_id,reviewed_at,reviewed_by) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9,$10,$9,NOW(),$11)`,[requestId,`setup_${crypto.randomUUID()}`,'Awaiting POS setup code claim',hashToken(requestToken),hashToken(normalizeSetupCode(setupCode)),expiresAt,branchId,storeNumber,posNo,touchpointId,String(req.user?.user_id||req.user?.id||'')||null]); return res.status(201).json({request_id:requestId,setup_code:setupCode,status:'PENDING',branch_id:branchId,store_number:storeNumber,pos_no:posNo,touchpoint_id:touchpointId,expires_at:expiresAt.toISOString()}); } catch(error){return next(error);} };

const claimSetupCode = async (req,res,next) => { try { const setupCode=normalizeSetupCode(req.body?.setup_code),deviceId=String(req.body?.device_id||'').trim(); if(!setupCode)return res.status(400).json({code:'SETUP_CODE_REQUIRED'}); if(!deviceId)return res.status(400).json({code:'DEVICE_ID_REQUIRED'}); let tenantId=''; try{tenantId=decodeTenantId(setupCode.split('.')[0]);}catch(_){} if(!tenantId)return res.status(400).json({code:'INVALID_SETUP_CODE'}); const context=await resolveTenantContext(tenantId); if(!context||context.tenant?.is_active===false)return res.status(403).json({code:'TENANT_UNAVAILABLE'}); await ensureTable(context.tenantPool); const pending=await context.tenantPool.query(`SELECT * FROM pos_registration_requests WHERE setup_code_hash=$1 AND status='PENDING' AND setup_code_expires_at>NOW() ORDER BY requested_at DESC LIMIT 1`,[hashToken(setupCode)]); if(!pending.rowCount)return res.status(404).json({code:'SETUP_CODE_NOT_FOUND'}); const request=pending.rows[0]; const registration=await ensureDeviceRegistration({tenantPool:context.tenantPool,branchId:request.branch_id,deviceId,userId:null,mode:'register',deviceInfo:{device_name:String(req.body?.device_name||'').trim()||request.pos_no,os_info:String(req.body?.os_info||'').trim()||null},businessIdentity:request}); if(!registration.allowed)return res.status(registration.code==='DEVICE_LIMIT_REACHED'?403:409).json({code:registration.code||'DEVICE_REGISTRATION_FAILED',limit:registration.limit}); const updated=await context.tenantPool.query(`UPDATE pos_registration_requests SET status='CLAIMED',device_id=$2,installation_id=$3,device_name=$4,os_info=$5,claimed_at=NOW() WHERE request_id=$1 AND status='PENDING' RETURNING request_id,device_id,branch_id,store_number,pos_no,touchpoint_id,terminal_id,status,claimed_at`,[request.request_id,deviceId,String(req.body?.installation_id||'').trim()||null,String(req.body?.device_name||'').trim()||request.pos_no,String(req.body?.os_info||'').trim()||null]); return res.json({...updated.rows[0],tenant_id:tenantId}); } catch(error){return next(error);} };

const listRegistrationRequests = async (req,res,next) => { try { await ensureTable(req.tenantPool); const status=String(req.query?.status||'').trim().toUpperCase(),params=[]; let where=''; if(status){params.push(status);where='WHERE status=$1';} const result=await req.tenantPool.query(`SELECT request_id,device_id,installation_id,device_name,os_info,status,branch_id,store_number,pos_no,touchpoint_id,terminal_id,requested_at,reviewed_at,reviewed_by,claimed_at FROM pos_registration_requests ${where} ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,requested_at DESC`,params); return res.json({requests:result.rows}); } catch(error){return next(error);} };

const approveRegistrationRequest = async (req,res,next) => { try { const requestId=String(req.params.requestId||'').trim(); await ensureTable(req.tenantPool); const pending=await req.tenantPool.query(`SELECT * FROM pos_registration_requests WHERE request_id=$1 AND status='PENDING'`,[requestId]); if(!pending.rowCount)return res.status(409).json({code:'REGISTRATION_NOT_PENDING'}); const request=pending.rows[0],branchId=String(request.branch_id||req.body?.branch_id||'').trim(),storeNumber=normalizeCode(request.store_number||req.body?.store_number),posNo=normalizeCode(request.pos_no||req.body?.pos_no||req.body?.terminal_id),touchpointId=normalizeCode(request.touchpoint_id||req.body?.touchpoint_id); if(!branchId||!storeNumber||!posNo||!touchpointId)return res.status(400).json({code:'POS_BUSINESS_IDENTITY_REQUIRED'}); const registration=await ensureDeviceRegistration({tenantPool:req.tenantPool,branchId,deviceId:request.device_id,userId:req.user?.user_id||req.user?.id,mode:'register',deviceInfo:{device_name:request.device_name,os_info:request.os_info},businessIdentity:{store_number:storeNumber,pos_no:posNo,touchpoint_id:touchpointId}}); if(!registration.allowed)return res.status(registration.code==='DEVICE_LIMIT_REACHED'?403:409).json({code:registration.code||'DEVICE_REGISTRATION_FAILED',limit:registration.limit,active_device_id:registration.activeDeviceId}); const updated=await req.tenantPool.query(`UPDATE pos_registration_requests SET status='APPROVED',branch_id=$2,store_number=$3,pos_no=$4,touchpoint_id=$5,terminal_id=$4,reviewed_at=NOW(),reviewed_by=$6 WHERE request_id=$1 RETURNING request_id,device_id,status,branch_id,store_number,pos_no,touchpoint_id,terminal_id,reviewed_at`,[requestId,branchId,storeNumber,posNo,touchpointId,String(req.user?.user_id||req.user?.id||'')||null]); return res.json(updated.rows[0]); } catch(error){return next(error);} };

const rejectRegistrationRequest = async (req,res,next) => { try { await ensureTable(req.tenantPool); const updated=await req.tenantPool.query(`UPDATE pos_registration_requests SET status='REJECTED',reviewed_at=NOW(),reviewed_by=$2 WHERE request_id=$1 AND status='PENDING' RETURNING request_id,status,reviewed_at`,[String(req.params.requestId||'').trim(),String(req.user?.user_id||req.user?.id||'')||null]); if(!updated.rowCount)return res.status(409).json({code:'REGISTRATION_NOT_PENDING'}); return res.json(updated.rows[0]); } catch(error){return next(error);} };

module.exports={createRegistrationRequest,registrationStatus,claimRegistration,createSetupCode,claimSetupCode,listRegistrationRequests,approveRegistrationRequest,rejectRegistrationRequest};
