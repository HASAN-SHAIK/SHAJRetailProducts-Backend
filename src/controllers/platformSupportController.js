const masterPool = require('../config/masterDb');
const { jsonError, jsonOk } = require('../utils/responses');

const SUPPORT_CATEGORIES = ['billing', 'technical', 'bug', 'feature_request'];
const SUPPORT_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const SUPPORT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

const parsePagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const getSupportCasesAdmin = async (req, res) => {
  const { page, limit, offset } = parsePagination(req);
  const status = req.query.status?.toString().trim().toLowerCase();
  const priority = req.query.priority?.toString().trim().toLowerCase();
  const category = req.query.category?.toString().trim().toLowerCase();
  const tenantId = req.query.tenant_id ? parseInt(req.query.tenant_id, 10) : null;

  if (status && !SUPPORT_STATUSES.includes(status)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid status');
  }
  if (priority && !SUPPORT_PRIORITIES.includes(priority)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid priority');
  }
  if (category && !SUPPORT_CATEGORIES.includes(category)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid category');
  }
  if (tenantId !== null && Number.isNaN(tenantId)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant_id');
  }

  try {
    const where = ['1=1'];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`sc.status = $${params.length}`);
    }
    if (priority) {
      params.push(priority);
      where.push(`sc.priority = $${params.length}`);
    }
    if (category) {
      params.push(category);
      where.push(`sc.category = $${params.length}`);
    }
    if (tenantId !== null) {
      params.push(tenantId);
      where.push(`sc.tenant_id = $${params.length}`);
    }

    const listParams = params.slice();
    listParams.push(limit, offset);

    const listRes = await masterPool.query(
      `SELECT sc.id, sc.tenant_id, t.shop_name AS tenant_name, sc.title, sc.category, sc.priority,
              sc.status, sc.assigned_to, a.name AS assigned_to_name, sc.created_at, sc.updated_at
       FROM support_cases sc
       JOIN tenants t ON t.id = sc.tenant_id
       LEFT JOIN platform_admins a ON a.id = sc.assigned_to
       WHERE ${where.join(' AND ')}
       ORDER BY sc.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const countRes = await masterPool.query(
      `SELECT COUNT(*)::int AS total
       FROM support_cases sc
       WHERE ${where.join(' AND ')}`,
      params
    );

    const total = countRes.rows[0]?.total || 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return jsonOk(res, {
      cases: listRes.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages
      }
    });
  } catch (error) {
    return jsonError(res, 500, 'SUPPORT_CASES_FETCH_FAILED', error.message);
  }
};

const getSupportCaseAdmin = async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  if (Number.isNaN(caseId)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid case id');
  }

  try {
    const caseRes = await masterPool.query(
      `SELECT sc.id, sc.tenant_id, t.shop_name AS tenant_name, sc.title, sc.description,
              sc.category, sc.priority, sc.status, sc.assigned_to, a.name AS assigned_to_name, sc.created_by,
              sc.created_at, sc.updated_at, sc.resolved_at
       FROM support_cases sc
       JOIN tenants t ON t.id = sc.tenant_id
       LEFT JOIN platform_admins a ON a.id = sc.assigned_to
       WHERE sc.id = $1`,
      [caseId]
    );
    if (caseRes.rowCount === 0) {
      return jsonError(res, 404, 'NOT_FOUND', 'Support case not found');
    }

    const messagesRes = await masterPool.query(
      `SELECT id, case_id, sender_type, sender_id, message, created_at
       FROM support_case_messages
       WHERE case_id = $1
       ORDER BY created_at ASC`,
      [caseId]
    );

    return jsonOk(res, {
      case: caseRes.rows[0],
      messages: messagesRes.rows
    });
  } catch (error) {
    return jsonError(res, 500, 'SUPPORT_CASE_FETCH_FAILED', error.message);
  }
};

const updateSupportCaseStatus = async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  const status = req.body?.status?.toString().trim().toLowerCase();
  if (Number.isNaN(caseId)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid case id');
  }
  if (!status || !SUPPORT_STATUSES.includes(status)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid status');
  }

  const resolvedAt = status === 'resolved' ? 'NOW() AT TIME ZONE \'UTC\'' : 'NULL';

  try {
    const updateRes = await masterPool.query(
      `UPDATE support_cases
       SET status = $1,
           updated_at = (NOW() AT TIME ZONE 'UTC'),
           resolved_at = ${resolvedAt}
       WHERE id = $2
       RETURNING id, status, updated_at, resolved_at`,
      [status, caseId]
    );
    if (updateRes.rowCount === 0) {
      return jsonError(res, 404, 'NOT_FOUND', 'Support case not found');
    }

    return jsonOk(res, { case: updateRes.rows[0] });
  } catch (error) {
    return jsonError(res, 500, 'SUPPORT_CASE_STATUS_UPDATE_FAILED', error.message);
  }
};

const updateSupportCaseAssignee = async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  const assignedTo = req.body?.assigned_to;
  if (Number.isNaN(caseId)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid case id');
  }
  if (assignedTo === null && assignedTo === undefined && Number.isNaN(parseInt(assignedTo, 10))) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid assigned_to');
  }

  try {
    const adminRes = await masterPool.query(
      `SELECT id FROM platform_admins WHERE email = $1 or name = $1`,
      [assignedTo]
    );
    if (adminRes.rowCount === 0) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Assigned admin not found');
    }
    const updateRes = await masterPool.query(
      `UPDATE support_cases
       SET assigned_to = $1,
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $2
       RETURNING id, assigned_to, updated_at`,
      [adminRes.rows[0].id, caseId]
    );
    if (updateRes.rowCount === 0) {
      return jsonError(res, 404, 'NOT_FOUND', 'Support case not found');
    }

    return jsonOk(res, { case: updateRes.rows[0] });
  } catch (error) {
    return jsonError(res, 500, 'SUPPORT_CASE_ASSIGN_UPDATE_FAILED', error.message);
  }
};

const updateSupportCasePriority = async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  const priority = req.body?.priority?.toString().trim().toLowerCase();
  if (Number.isNaN(caseId)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid case id');
  }
  if (!priority || !SUPPORT_PRIORITIES.includes(priority)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid priority');
  }

  try {
    const updateRes = await masterPool.query(
      `UPDATE support_cases
       SET priority = $1,
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $2
       RETURNING id, priority, updated_at`,
      [priority, caseId]
    );
    if (updateRes.rowCount === 0) {
      return jsonError(res, 404, 'NOT_FOUND', 'Support case not found');
    }

    return jsonOk(res, { case: updateRes.rows[0] });
  } catch (error) {
    return jsonError(res, 500, 'SUPPORT_CASE_PRIORITY_UPDATE_FAILED', error.message);
  }
};

const replySupportCaseAdmin = async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  const message = req.body?.message?.toString().trim();
  const adminId = req.admin?.admin_id;

  if (Number.isNaN(caseId)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid case id');
  }
  if (!adminId) {
    return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  }
  if (!message) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'message is required');
  }

  try {
    const caseRes = await masterPool.query(
      `SELECT id FROM support_cases WHERE id = $1`,
      [caseId]
    );
    if (caseRes.rowCount === 0) {
      return jsonError(res, 404, 'NOT_FOUND', 'Support case not found');
    }

    const insertRes = await masterPool.query(
      `INSERT INTO support_case_messages (case_id, sender_type, sender_id, message)
       VALUES ($1, 'admin', $2, $3)
       RETURNING id, case_id, sender_type, sender_id, message, created_at`,
      [caseId, adminId, message]
    );

    await masterPool.query(
      `UPDATE support_cases
       SET updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $1`,
      [caseId]
    );

    return res.status(201).json({
      success: true,
      data: {
        message: insertRes.rows[0]
      }
    });
  } catch (error) {
    return jsonError(res, 500, 'SUPPORT_CASE_REPLY_FAILED', error.message);
  }
};

module.exports = {
  getSupportCasesAdmin,
  getSupportCaseAdmin,
  updateSupportCaseStatus,
  updateSupportCaseAssignee,
  updateSupportCasePriority,
  replySupportCaseAdmin
};
