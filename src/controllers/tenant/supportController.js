const masterPool = require('../../config/masterDb');
const { jsonError, jsonOk } = require('../../utils/responses');
const { notifyNewSupportCase } = require('../../services/supportNotification.service');

const SUPPORT_CATEGORIES = ['billing', 'technical', 'bug', 'feature_request'];
const SUPPORT_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const parsePagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const getSupportCases = async (req, res) => {
  const tenantId = req.tenant_id;
  if (!tenantId) return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');

  const { page, limit, offset } = parsePagination(req);

  try {
    const listRes = await masterPool.query(
      `SELECT id, title, category, priority, status, created_at, updated_at
       FROM support_cases
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset]
    );

    const countRes = await masterPool.query(
      `SELECT COUNT(*)::int AS total
       FROM support_cases
       WHERE tenant_id = $1`,
      [tenantId]
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

const getSupportCase = async (req, res) => {
  const tenantId = req.tenant_id;
  const caseId = parseInt(req.params.id, 10);
  if (!tenantId) return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  if (Number.isNaN(caseId)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid case id');
  }

  try {
    const caseRes = await masterPool.query(
      `SELECT id, tenant_id, title, description, category, priority, status,
              assigned_to, created_by, created_at, updated_at, resolved_at
       FROM support_cases
       WHERE id = $1 AND tenant_id = $2`,
      [caseId, tenantId]
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

const replySupportCase = async (req, res) => {
  const tenantId = req.tenant_id;
  const userId = req.user?.user_id;
  const caseId = parseInt(req.params.id, 10);
  const message = req.body?.message?.toString().trim();

  if (!tenantId || !userId) return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  if (Number.isNaN(caseId)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid case id');
  }
  if (!message) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'message is required');
  }

  try {
    const caseRes = await masterPool.query(
      `SELECT id FROM support_cases WHERE id = $1 AND tenant_id = $2`,
      [caseId, tenantId]
    );
    if (caseRes.rowCount === 0) {
      return jsonError(res, 404, 'NOT_FOUND', 'Support case not found');
    }

    const insertRes = await masterPool.query(
      `INSERT INTO support_case_messages (case_id, sender_type, sender_id, message)
       VALUES ($1, 'tenant', $2, $3)
       RETURNING id, case_id, sender_type, sender_id, message, created_at`,
      [caseId, userId, message]
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

const createSupportCase = async (req, res) => {
  const tenantId = req.tenant_id;
  const userId = req.user?.user_id;
  if (!tenantId || !userId) return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');

  const title = req.body?.title?.toString().trim();
  const description = req.body?.description?.toString().trim();
  const category = req.body?.category?.toString().trim().toLowerCase();
  const priority = req.body?.priority?.toString().trim().toLowerCase() || 'medium';

  if (!title || !description || !category) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'title, description, category are required');
  }
  if (!SUPPORT_CATEGORIES.includes(category)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid category');
  }
  if (!SUPPORT_PRIORITIES.includes(priority)) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid priority');
  }
  if (priority === 'urgent' && !req.planFeatures?.priority_support) {
    return jsonError(res, 403, 'FEATURE_DISABLED', 'Urgent priority is not available on your plan');
  }

  try {
    const insertRes = await masterPool.query(
      `INSERT INTO support_cases
       (tenant_id, title, description, category, priority, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'open', $6)
       RETURNING id, title, category, priority, status, created_at, updated_at`,
      [tenantId, title, description, category, priority, userId]
    );

    const createdCase = insertRes.rows[0];
    let creator = { name: req.user?.user_name || null, email: null };
    try {
      if (req.tenantPool && userId) {
        const userRes = await req.tenantPool.query(
          `SELECT name, email
           FROM users
           WHERE id = $1`,
          [userId]
        );
        if (userRes.rowCount > 0) {
          creator = {
            name: userRes.rows[0]?.name || creator.name,
            email: userRes.rows[0]?.email || null
          };
        }
      }
    } catch {
      // ignore lookup error, email notification will still proceed with available details
    }

    notifyNewSupportCase({
      caseId: createdCase.id,
      tenantId,
      title,
      description,
      category,
      priority,
      createdByName: creator.name,
      createdByEmail: creator.email
    }).catch(() => null);

    return res.status(201).json({
      success: true,
      data: {
        case: createdCase
      }
    });
  } catch (error) {
    return jsonError(res, 500, 'SUPPORT_CASE_CREATE_FAILED', error.message);
  }
};

const getSupportCategories = (req, res) =>
  jsonOk(res, { categories: SUPPORT_CATEGORIES });

module.exports = {
  getSupportCases,
  getSupportCase,
  createSupportCase,
  getSupportCategories,
  replySupportCase
};
