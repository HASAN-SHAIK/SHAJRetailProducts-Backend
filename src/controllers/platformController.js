const masterPool = require('../db/masterPool');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { createTenant } = require('../services/tenantService');
const {
  getDashboardStats,
  getRevenueReport,
  getRevenueSeries,
  getRevenueByPlan,
  getRecentActivityLogs,
  getTopTenantsByRevenue
} = require('../services/analyticsService');
const { resolveTenantContext } = require('../config/tenantDbResolver');
const { normalizeBranchId } = require('../utils/branch');
const { jsonError, jsonOk } = require('../utils/responses');
const { getPlanFeatures } = require('../utils/planFeatures');
const { resolvePlanDeviceLimit, normalizePlan } = require('../config/planDeviceLimits');
const { resolveFeatures } = require('../utils/resolveFeatures');
const { sanitizeAddons } = require('../utils/addons');

const GST_MODES = new Set(['INCLUSIVE', 'EXCLUSIVE']);

const normalizeGstMode = (value, fallback = 'INCLUSIVE') => {
  if (value === undefined || value === null || value === '') return fallback;
  const mode = String(value).trim().toUpperCase();
  return GST_MODES.has(mode) ? mode : null;
};

const logAdminAction = async (adminId, action, entityType, entityId, metadata) => {
  if (!adminId) return;
  if (!(await hasMasterTable('platform_activity_logs'))) {
    return;
  }
  await masterPool.query(
    `INSERT INTO platform_activity_logs (admin_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, action, entityType, entityId || null, metadata || {}]
  );
};

const isSubscriptionActive = (subscription) => {
  if (!subscription) return false;
  const isPaid = subscription.payment_status === 'paid';
  const isExpired = subscription.end_date ? new Date(subscription.end_date) < new Date() : true;
  return isPaid && !isExpired;
};

const resolveRenewalWindow = async (lastEndDate, durationDays) => {
  const normalizedDuration = Number.isFinite(Number(durationDays)) && Number(durationDays) > 0
    ? Number(durationDays)
    : 30;
  const result = await masterPool.query(
    `SELECT
       CASE
         WHEN $1::date IS NOT NULL AND $1::date >= CURRENT_DATE THEN $1::date
         ELSE CURRENT_DATE
       END AS start_date,
       (
         CASE
           WHEN $1::date IS NOT NULL AND $1::date >= CURRENT_DATE THEN $1::date
           ELSE CURRENT_DATE
         END
         + ($2 || ' days')::interval
       )::date AS end_date`,
    [lastEndDate || null, normalizedDuration]
  );
  return {
    start_date: result.rows[0]?.start_date || null,
    end_date: result.rows[0]?.end_date || null,
    duration_days: normalizedDuration
  };
};

const masterTableExistsCache = new Map();
const hasMasterTable = async (tableName) => {
  if (masterTableExistsCache.has(tableName)) {
    return masterTableExistsCache.get(tableName);
  }
  const res = await masterPool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = $1
     LIMIT 1`,
    [tableName]
  );
  const exists = res.rowCount > 0;
  masterTableExistsCache.set(tableName, exists);
  return exists;
};

const createTenantHandler = async (req, res) => {
  try {
      const {
        shop_name,
        domain,
        plan_type,
        owner_name,
        email,
        mobile,
        gst_number,
        address_line,
        city,
        state,
        pincode,
        subscription_end_date,
        subscription_amount,
        gst_mode
      } = req.body;

    const forbiddenFeatureFields = [
      'featureFlags',
      'features',
      'enable_piece_based',
      'enable_weight_based',
      'is_order_based',
      'customer_details_enabled',
      'GST_invoice_enabled',
      'advanced_reports',
      'analytical_reports',
      'api_access',
      'multi_branch',
      'priority_support',
      'max_users'
    ];
    const hasForbiddenFields = forbiddenFeatureFields.some((key) =>
      Object.prototype.hasOwnProperty.call(req.body || {}, key)
    );
    if (hasForbiddenFields) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Manual feature overrides are not allowed');
    }

    if (!shop_name || !domain) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing required tenant fields');
    }

    const resolvedGstMode = normalizeGstMode(gst_mode);
    if (gst_mode !== undefined && gst_mode !== null && !resolvedGstMode) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'gst_mode must be INCLUSIVE or EXCLUSIVE');
    }

      const result = await createTenant({
        shop_name,
        domain,
        plan_type,
        owner_name,
        email,
        mobile,
        gst_number,
        address_line,
        city,
        state,
        pincode,
        subscription_end_date,
        subscription_amount,
        gst_mode: resolvedGstMode || 'INCLUSIVE'
      });

    await logAdminAction(req.admin?.admin_id, 'TENANT_CREATED', 'tenant', result.tenant_id, {
      shop_name,
      plan_type,
      domain
    });

    return jsonOk(res, { tenant_id: result.tenant_id }, 'Tenant created');
  } catch (error) {
    return jsonError(res, 500, 'TENANT_CREATE_FAILED', error.message);
  }
};

const getDashboardHandler = async (req, res) => {
  try {
    const [stats, revenueSeries, revenueByPlan, activityLogs] = await Promise.all([
      getDashboardStats(),
      getRevenueSeries(),
      getRevenueByPlan(),
      getRecentActivityLogs(5)
    ]);

    const systemLogs = activityLogs.map((log) => ({
      id: `LOG-${log.id}`,
      message: `${log.action}${log.entity_type ? ` (${log.entity_type})` : ''}`,
      level: 'info'
    }));

    const summary = {
      totalTenants: stats.total_tenants,
      activeTenants: stats.active_tenants,
      inactiveTenants: stats.inactive_tenants,
      expiredTenants: stats.expired_subscriptions,
      monthlyRevenue: Number(stats.monthly_revenue),
      paidSubscriptions: stats.paid_subscriptions,
      newTenants: stats.new_tenants,
      recentOrders: [],
      systemLogs,
      revenueByPlan
    };

    const subscriptions = {
      paidCount: stats.paid_subscriptions,
      activeCount: stats.active_subscriptions,
      expiredCount: stats.expired_subscriptions
    };

    await logAdminAction(req.admin?.admin_id, 'DASHBOARD_VIEWED', 'platform', null, null);
    return jsonOk(res, { summary, revenueSeries, subscriptions });
  } catch (error) {
    return jsonError(res, 500, 'DASHBOARD_STATS_FAILED', error.message);
  }
};

const getReportsHandler = async (req, res) => {
  try {
    const [stats, revenueSeries, revenueByPlan, activityLogs] = await Promise.all([
      getDashboardStats(),
      getRevenueSeries(),
      getRevenueByPlan(),
      getRecentActivityLogs(5)
    ]);

    const systemLogs = activityLogs.map((log) => ({
      id: `LOG-${log.id}`,
      message: `${log.action}${log.entity_type ? ` (${log.entity_type})` : ''}`,
      level: 'info'
    }));

    const summary = {
      totalTenants: stats.total_tenants,
      activeTenants: stats.active_tenants,
      inactiveTenants: stats.inactive_tenants,
      expiredTenants: stats.expired_subscriptions,
      monthlyRevenue: Number(stats.monthly_revenue),
      paidSubscriptions: stats.paid_subscriptions,
      newTenants: stats.new_tenants,
      recentOrders: [],
      systemLogs,
      revenueByPlan
    };

    await logAdminAction(req.admin?.admin_id, 'REPORTS_VIEWED', 'report', null, null);
    return jsonOk(res, { summary, revenueSeries });
  } catch (error) {
    return jsonError(res, 500, 'REPORTS_FAILED', error.message);
  }
};

const getGlobalReportsHandler = async (req, res) => {
  try {
    const [revenueSeries, topTenants] = await Promise.all([
      getRevenueSeries(),
      getTopTenantsByRevenue(10)
    ]);

    await logAdminAction(req.admin?.admin_id, 'GLOBAL_REPORTS_VIEWED', 'report', null, null);
    return jsonOk(res, { revenueSeries, topTenants });
  } catch (error) {
    return jsonError(res, 500, 'GLOBAL_REPORTS_FAILED', error.message);
  }
};

const getSubscriptionsSummary = async (req, res) => {
  try {
    const stats = await getDashboardStats();
    await logAdminAction(req.admin?.admin_id, 'SUBSCRIPTIONS_SUMMARY_VIEWED', 'subscription', null, null);
    return jsonOk(res, { paidCount: stats.paid_subscriptions });
  } catch (error) {
    return jsonError(res, 500, 'SUBSCRIPTIONS_SUMMARY_FAILED', error.message);
  }
};

const getTenants = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSizeRaw = Number(req.query.pageSize);
    const limit = Math.min(pageSizeRaw || Number(req.query.limit) || 50, 200);
    const offset = Math.max((page - 1) * limit, 0);
    const plan = req.query.plan?.toString().trim();
    const status = req.query.status?.toString().trim().toLowerCase();
    const query = req.query.query?.toString().trim();

    const where = [];
    const values = [];

    if (plan) {
      values.push(plan);
      where.push(`LOWER(t.plan_type) = LOWER($${values.length})`);
    }

    if (status === 'active') {
      where.push(`t.is_active = TRUE`);
    } else if (status === 'inactive') {
      where.push(`t.is_active = FALSE`);
    }

    if (query) {
      values.push(`%${query}%`);
      const q = values.length;
      where.push(
        `(t.shop_name ILIKE $${q}
          OR t.owner_name ILIKE $${q}
          OR t.email ILIKE $${q}
          OR t.mobile ILIKE $${q}
          OR t.domain ILIKE $${q})`
      );
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await masterPool.query(
      `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.domain, t.plan_type, t.is_active, t.created_at,
              t.addons,
              s.end_date AS subscription_end_date,
              s.payment_status AS subscription_payment_status,
              s.plan_id AS subscription_plan_id,
              psub.name AS subscription_plan_name
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT end_date, payment_status, plan_id
         FROM subscriptions
         WHERE tenant_id = t.id
         ORDER BY end_date DESC NULLS LAST, id DESC
         LIMIT 1
       ) s ON TRUE
       LEFT JOIN plans psub ON psub.id = s.plan_id
       ${whereClause}
       ORDER BY t.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    await logAdminAction(req.admin?.admin_id, 'TENANTS_VIEWED', 'tenant', null, {
      limit,
      offset,
      plan: plan || null,
      status: status || null
    });

    const tenants = result.rows.map((row) => {
      const subscription = {
        payment_status: row.subscription_payment_status,
        end_date: row.subscription_end_date
      };
      const planName = row.subscription_plan_name || row.plan_type;
      const planFeatures = resolveFeatures({
        plan_type: planName,
        addons: row.addons || {}
      });
      return {
        id: row.id,
        shop_name: row.shop_name,
        owner_name: row.owner_name,
        is_active: row.is_active,
        plan_type: planName,
        subscription_end_date: row.subscription_end_date,
        plan_features: planFeatures
      };
    });

    return jsonOk(res, { tenants, page, pageSize: limit });
  } catch (error) {
    return jsonError(res, 500, 'TENANT_LIST_FAILED', error.message);
  }
};

const getTenantById = async (req, res) => {
  try {
    const tenantId = Number(req.params.id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const context = await resolveTenantContext(tenantId);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const tenantRes = await masterPool.query(
      `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.domain, t.plan_type, t.is_active, t.created_at, t.addons, t.gst_mode
       FROM tenants t
       WHERE t.id = $1`,
      [tenantId]
    );
    if (tenantRes.rowCount === 0) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const subRes = await masterPool.query(
      `SELECT s.payment_status, s.end_date, s.amount, s.plan_id, p.name AS plan_name
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1
       ORDER BY s.end_date DESC
       LIMIT 1`,
      [tenantId]
    );
    const subscription = subRes.rowCount > 0 ? subRes.rows[0] : null;
    const resolvedPlanType = subscription?.plan_name || tenantRes.rows[0].plan_type;
    const planFeatures = resolveFeatures({
      ...tenantRes.rows[0],
      plan_type: resolvedPlanType,
      addons: tenantRes.rows[0].addons || {}
    });
    const planLookupRes = subscription?.plan_id
      ? await masterPool.query(
          `SELECT id, name, price, duration_days
           FROM plans
           WHERE id = $1`,
          [subscription.plan_id]
        )
      : await masterPool.query(
          `SELECT id, name, price, duration_days
           FROM plans
           WHERE LOWER(name) = LOWER($1)
           LIMIT 1`,
          [resolvedPlanType]
        );
    const planRow = planLookupRes.rowCount > 0 ? planLookupRes.rows[0] : null;
    const renewalWindow = await resolveRenewalWindow(
      subscription?.end_date || null,
      planRow?.duration_days
    );

      const [productsRes, ordersRes, revenueRes] = await Promise.all([
        context.tenantPool.query(
          `SELECT COUNT(*)::int AS count FROM products WHERE is_deleted = FALSE`
        ),
        context.tenantPool.query(
          `SELECT COUNT(*)::int AS count
           FROM orders
           WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'`
        ),
        context.tenantPool.query(
          `SELECT COALESCE(SUM(total_price), 0)::numeric AS revenue
           FROM orders
           WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'`
        )
      ]);

      const shopDetailsRes = await context.tenantPool.query(
        `SELECT gst_number, address_line, city, state, pincode
         FROM shop_details
         ORDER BY id ASC
         LIMIT 1`
      );

    const subscriptionHistoryRes = await masterPool.query(
      `SELECT s.id, s.start_date, s.end_date, s.amount, s.payment_status, p.name AS plan_name
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1
       ORDER BY s.end_date DESC NULLS LAST, s.id DESC`,
      [tenantId]
    );

    const paymentHistoryRes = (await hasMasterTable('subscription_payments'))
      ? await masterPool.query(
          `SELECT sp.id, sp.amount, sp.status, sp.payment_method, sp.paid_at, p.name AS plan_name
           FROM subscription_payments sp
           LEFT JOIN plans p ON p.id = sp.plan_id
           WHERE sp.tenant_id = $1
           ORDER BY sp.paid_at DESC NULLS LAST, sp.id DESC`,
          [tenantId]
        )
      : { rows: [] };

      const tenant = {
        ...tenantRes.rows[0],
        plan_type: resolvedPlanType,
        plan_features: planFeatures,
        renewal: {
          can_renew: Boolean(planRow),
          plan_id: planRow?.id ?? subscription?.plan_id ?? null,
          plan_name: planRow?.name ?? resolvedPlanType ?? null,
          price: planRow?.price ?? subscription?.amount ?? null,
          duration_days: renewalWindow.duration_days,
          next_start_date: renewalWindow.start_date,
          next_end_date: renewalWindow.end_date
        },
        shop_details: shopDetailsRes.rows[0] || {
          gst_number: null,
          address_line: null,
          city: null,
          state: null,
          pincode: null
        },
        metrics: {
          products: productsRes.rows[0].count,
          orders7d: ordersRes.rows[0].count,
        revenue7d: Number(revenueRes.rows[0].revenue),
        lastLogin: null
      },
      subscriptionHistory: subscriptionHistoryRes.rows,
      paymentHistory: paymentHistoryRes.rows
    };
    await logAdminAction(req.admin?.admin_id, 'TENANT_VIEWED', 'tenant', tenantId, null);

    return jsonOk(res, {
      tenant,
      subscription
    });
  } catch (error) {
    return jsonError(res, 500, 'TENANT_FETCH_FAILED', error.message);
  }
};

const updateTenant = async (req, res) => {
  try {
  const {
    tenant_id,
    shop_name,
    owner_name,
    email,
    mobile,
    plan_type,
    is_active,
    gst_number,
    address_line,
    city,
    state,
    pincode,
    gst_mode
  } = req.body || {};
    if (!tenant_id) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Missing tenant_id');
    }

    const updates = [];
    const values = [];

    const addField = (field, value) => {
      if (value !== undefined) {
        values.push(value);
        updates.push(`${field} = $${values.length}`);
      }
    };

    addField('shop_name', shop_name);
    addField('owner_name', owner_name);
    addField('email', email);
    addField('mobile', mobile);
    addField('plan_type', plan_type);
    addField('is_active', is_active);
    if (gst_mode !== undefined) {
      const resolvedGstMode = normalizeGstMode(gst_mode, null);
      if (!resolvedGstMode) {
        return jsonError(res, 400, 'VALIDATION_ERROR', 'gst_mode must be INCLUSIVE or EXCLUSIVE');
      }
      addField('gst_mode', resolvedGstMode);
    }

    const hasShopDetailsUpdate =
      gst_number !== undefined ||
      address_line !== undefined ||
      city !== undefined ||
      state !== undefined ||
      pincode !== undefined;

    if (updates.length === 0 && !hasShopDetailsUpdate) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'No fields to update');
    }

    let result = { rowCount: 0, rows: [] };
    if (updates.length > 0) {
      values.push(tenant_id);
      result = await masterPool.query(
        `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${values.length}
         RETURNING id, shop_name, owner_name, email, mobile, plan_type, is_active, gst_mode, created_at`,
        values
      );
    }

    const context = await resolveTenantContext(tenant_id);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    if (hasShopDetailsUpdate) {
      const existingShop = await context.tenantPool.query(
        `SELECT id FROM shop_details ORDER BY id ASC LIMIT 1`
      );
      if (existingShop.rowCount === 0) {
        await context.tenantPool.query(
          `INSERT INTO shop_details (shop_name, owner_name, mobile_number, gst_number, address_line, city, state, pincode)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            shop_name ?? context.tenant?.shop_name ?? null,
            owner_name ?? context.tenant?.owner_name ?? null,
            mobile ?? context.tenant?.mobile ?? null,
            gst_number ?? null,
            address_line ?? null,
            city ?? null,
            state ?? null,
            pincode ?? null
          ]
        );
      } else {
        const shopUpdates = [];
        const shopValues = [];
        const addShopField = (field, value) => {
          if (value !== undefined) {
            shopValues.push(value);
            shopUpdates.push(`${field} = $${shopValues.length}`);
          }
        };
        addShopField('gst_number', gst_number);
        addShopField('address_line', address_line);
        addShopField('city', city);
        addShopField('state', state);
        addShopField('pincode', pincode);
        addShopField('shop_name', shop_name);
        addShopField('owner_name', owner_name);
        addShopField('mobile_number', mobile);

        if (shopUpdates.length > 0) {
          await context.tenantPool.query(
            `UPDATE shop_details SET ${shopUpdates.join(', ')} WHERE id = $${shopValues.length + 1}`,
            [...shopValues, existingShop.rows[0].id]
          );
        }
      }
    }

    if (updates.length > 0 && result.rowCount === 0) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    await logAdminAction(req.admin?.admin_id, 'TENANT_UPDATED', 'tenant', tenant_id, {
      fields: updates.map((u) => u.split('=')[0].trim())
    });

    const tenantRow = updates.length > 0 ? result.rows[0] : context.tenant;
    const shopDetailsRes = await context.tenantPool.query(
      `SELECT gst_number, address_line, city, state, pincode
       FROM shop_details
       ORDER BY id ASC
       LIMIT 1`
    );

    return jsonOk(
      res,
      {
        ...tenantRow,
        shop_details: shopDetailsRes.rows[0] || {
          gst_number: null,
          address_line: null,
          city: null,
          state: null,
          pincode: null
        }
      },
      'Tenant updated'
    );
  } catch (error) {
    return jsonError(res, 500, 'TENANT_UPDATE_FAILED', error.message);
  }
};

const updateTenantByParam = async (req, res) => {
  const tenantId = Number(req.params.tenant_id);
  if (!tenantId) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
  }
  req.body = { ...(req.body || {}), tenant_id: tenantId };
  return updateTenant(req, res);
};

const updatePlan = async (req, res) => {
  try {
    const tenantId = Number(req.params.tenant_id);
    const { plan_id, plan: planName, payment_amount, payment_status, payment_method } = req.body || {};

    const allowedKeys = new Set([
      'plan_id',
      'plan',
      'payment_amount',
      'payment_status',
      'payment_method'
    ]);
    const unexpectedKeys = Object.keys(req.body || {}).filter((key) => !allowedKeys.has(key));
    if (unexpectedKeys.length > 0) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Only plan updates are allowed');
    }

    if (!tenantId || (!plan_id && !planName)) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'tenant_id and plan_id or plan are required');
    }

    const planRes = plan_id
      ? await masterPool.query(
          `SELECT id, name, price
           FROM plans
           WHERE id = $1 AND is_active = TRUE`,
          [plan_id]
        )
      : await masterPool.query(
          `SELECT id, name, price
           FROM plans
           WHERE LOWER(name) = LOWER($1) AND is_active = TRUE`,
          [planName]
        );
    if (planRes.rowCount === 0) {
      return jsonError(res, 404, 'PLAN_NOT_FOUND', 'Plan not found');
    }

    const planRow = planRes.rows[0];

    await masterPool.query(
      `UPDATE tenants SET plan_type = $1 WHERE id = $2`,
      [planRow.name, tenantId]
    );

    await masterPool.query(
      `UPDATE subscriptions
       SET plan_id = $1,
           amount = COALESCE($2, amount),
           payment_status = COALESCE($3, payment_status)
       WHERE id = (
         SELECT id
         FROM subscriptions
         WHERE tenant_id = $4
         ORDER BY end_date DESC NULLS LAST, id DESC
         LIMIT 1
       )`,
      [planRow.id, payment_amount ?? null, payment_status || null, tenantId]
    );

    if (payment_amount !== undefined && payment_amount !== null) {
      await masterPool.query(
        `INSERT INTO subscription_payments (tenant_id, plan_id, amount, status, payment_method)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, planRow.id, payment_amount, payment_status || 'paid', payment_method || null]
      );
    }

    await logAdminAction(req.admin?.admin_id, 'PLAN_UPDATED', 'tenant', tenantId, {
      plan_id: planRow.id,
      plan_name: planRow.name,
      payment_amount: payment_amount ?? null
    });

    return jsonOk(
      res,
      { tenant_id: tenantId, plan_id: planRow.id, plan_name: planRow.name },
      'Plan updated'
    );
  } catch (error) {
    return jsonError(res, 500, 'PLAN_UPDATE_FAILED', error.message);
  }
};

const updateTenantPlanAndFlags = async (req, res) => {
  const client = await masterPool.connect();
  try {
    const tenantId = Number(req.params.tenant_id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const allowedKeys = new Set([
      'plan_id',
      'plan',
      'payment_amount',
      'payment_status',
      'payment_method',
      'gst_number',
      'address_line',
      'city',
      'state',
      'pincode',
      'gst_mode',
      'shop_name',
      'owner_name',
      'email',
      'mobile',
      'plan_type',
      'is_active'
    ]);
    const unexpectedKeys = Object.keys(req.body || {}).filter((key) => !allowedKeys.has(key));
    if (unexpectedKeys.length > 0) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Only plan updates are allowed');
    }

    const {
      plan_id,
      plan: planName,
      payment_amount,
      payment_status,
      payment_method
    } = req.body || {};

    const hasShopUpdates = [
      'gst_number',
      'address_line',
      'city',
      'state',
      'pincode',
      'gst_mode',
      'shop_name',
      'owner_name',
      'email',
      'mobile',
      'plan_type',
      'is_active'
    ].some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));

    if (hasShopUpdates && !plan_id && !planName && payment_amount === undefined && !payment_status && !payment_method) {
      return updateTenantByParam(req, res);
    }

    if (!plan_id && !planName && payment_amount === undefined && !payment_status && !payment_method) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'No updates provided');
    }

    if (!plan_id && !planName && (payment_amount !== undefined || payment_status || payment_method)) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'plan_id or plan is required for payment updates');
    }

    await client.query('BEGIN');

    let planRow = null;
    if (plan_id || planName) {
        const planRes = plan_id
          ? await client.query(
              `SELECT id, name, price
               FROM plans
               WHERE id = $1 AND is_active = TRUE`,
              [plan_id]
            )
          : await client.query(
              `SELECT id, name, price
               FROM plans
               WHERE LOWER(name) = LOWER($1) AND is_active = TRUE`,
              [planName]
            );
      if (planRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return jsonError(res, 404, 'PLAN_NOT_FOUND', 'Plan not found');
      }
      planRow = planRes.rows[0];

      await client.query(
        `UPDATE tenants SET plan_type = $1 WHERE id = $2`,
        [planRow.name, tenantId]
      );

      await client.query(
        `UPDATE subscriptions
         SET plan_id = $1,
             amount = COALESCE($2, amount),
             payment_status = COALESCE($3, payment_status)
         WHERE id = (
           SELECT id
           FROM subscriptions
           WHERE tenant_id = $4
           ORDER BY end_date DESC NULLS LAST, id DESC
           LIMIT 1
         )`,
        [planRow.id, payment_amount ?? null, payment_status || null, tenantId]
      );

      if (payment_amount !== undefined && payment_amount !== null) {
        await client.query(
          `INSERT INTO subscription_payments (tenant_id, plan_id, amount, status, payment_method)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, planRow.id, payment_amount, payment_status || 'paid', payment_method || null]
        );
      }
    }

    await client.query('COMMIT');

    await logAdminAction(req.admin?.admin_id, 'TENANT_PLAN_UPDATED', 'tenant', tenantId, {
      plan_id: planRow?.id ?? null,
      plan_name: planRow?.name ?? null,
      payment_amount: payment_amount ?? null
    });

    return jsonOk(res, {
      tenant_id: tenantId,
      plan_id: planRow?.id ?? null,
      plan_name: planRow?.name ?? null
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return jsonError(res, 500, 'TENANT_UPDATE_FAILED', error.message);
  } finally {
    client.release();
  }
  };

const updateTenantAddons = async (req, res) => {
  try {
    const tenantId = Number(req.params.tenant_id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const { addons } = req.body || {};
    const parsed = sanitizeAddons(addons, { strict: true });
    if (!parsed.valid) {
      return jsonError(
        res,
        400,
        'VALIDATION_ERROR',
        'addons must only contain allowed keys with boolean values'
      );
    }

    const result = await masterPool.query(
      `UPDATE tenants
       SET addons = $1
       WHERE id = $2
       RETURNING id, shop_name, plan_type, addons, is_active`,
      [parsed.addons, tenantId]
    );

    if (result.rowCount === 0) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    await logAdminAction(req.admin?.admin_id, 'TENANT_ADDONS_UPDATED', 'tenant', tenantId, {
      addons: parsed.addons
    });

    return jsonOk(res, { tenant: result.rows[0] }, 'Tenant addons updated');
  } catch (error) {
    return jsonError(res, 500, 'TENANT_ADDONS_UPDATE_FAILED', error.message);
  }
};

const upgradeTenantPlan = async (req, res) => {
  const client = await masterPool.connect();
  try {
    const tenantId = Number(req.params.tenant_id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const { newPlan, payment_status, payment_method, payment_amount } = req.body || {};
    const allowedKeys = new Set([
      'newPlan',
      'payment_status',
      'payment_method',
      'payment_amount'
    ]);
    const unexpectedKeys = Object.keys(req.body || {}).filter((key) => !allowedKeys.has(key));
    if (unexpectedKeys.length > 0) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Only plan updates are allowed');
    }
    if (!newPlan) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'newPlan is required');
    }

    const planTiers = ['basic', 'pro', 'premium'];

    const currentTenantRes = await client.query(
      `SELECT id, plan_type FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (currentTenantRes.rowCount === 0) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const currentPlanName = currentTenantRes.rows[0].plan_type?.toString().trim().toLowerCase();
    const newPlanName = newPlan.toString().trim().toLowerCase();
    const currentTierIndex = planTiers.indexOf(currentPlanName);
    const newTierIndex = planTiers.indexOf(newPlanName);

    if (currentTierIndex < 0 || newTierIndex < 0) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid plan tier');
    }

    if (newTierIndex === currentTierIndex) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'New plan must be different');
    }

    const currentSubscriptionRes = await client.query(
      `SELECT id, plan_id, end_date, amount
       FROM subscriptions
       WHERE tenant_id = $1
       ORDER BY end_date DESC NULLS LAST, id DESC
       LIMIT 1`,
      [tenantId]
    );
    if (currentSubscriptionRes.rowCount === 0) {
      return jsonError(res, 404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
    }

    const subscription = currentSubscriptionRes.rows[0];
    if (!subscription.end_date) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Subscription end date is missing');
    }

    const newPlanRes = await client.query(
      `SELECT id, name, price
       FROM plans
       WHERE LOWER(name) = LOWER($1) AND is_active = TRUE`,
      [newPlanName]
    );
    if (newPlanRes.rowCount === 0) {
      return jsonError(res, 404, 'PLAN_NOT_FOUND', 'Plan not found');
    }
    const nextPlan = newPlanRes.rows[0];

    const remainingDaysRes = await client.query(
      `SELECT GREATEST(0, (end_date::date - CURRENT_DATE))::int AS remaining_days
       FROM subscriptions
       WHERE id = $1`,
      [subscription.id]
    );
    const remainingDays = Number(remainingDaysRes.rows[0].remaining_days || 0);

    if (remainingDays <= 0) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Subscription already expired');
    }

    if (newTierIndex < currentTierIndex && remainingDays > 3) {
      return jsonError(
        res,
        400,
        'VALIDATION_ERROR',
        'Plan downgrade allowed only in the last 3 days'
      );
    }

    const currentAmount = Number(subscription.amount || 0);
    const newPlanPrice = Number(nextPlan.price || 0);
    const prorateFactor = Math.min(remainingDays, 30) / 30;
    const extraAmountRaw = (newPlanPrice - currentAmount) * prorateFactor;
    const extraAmount = Math.max(0, Math.round(extraAmountRaw * 100) / 100);

    if (payment_amount !== undefined && Number(payment_amount) < extraAmount) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Payment amount is insufficient');
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE tenants SET plan_type = $1 WHERE id = $2`,
      [nextPlan.name, tenantId]
    );

    await client.query(
      `UPDATE subscriptions
       SET plan_id = $1,
           amount = $2
       WHERE id = $3`,
      [nextPlan.id, newPlanPrice, subscription.id]
    );

    if (extraAmount > 0) {
      await client.query(
        `INSERT INTO subscription_payments (tenant_id, plan_id, amount, status, payment_method)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantId,
          nextPlan.id,
          extraAmount,
          payment_status || 'paid',
          payment_method || null
        ]
      );
    }

    await client.query('COMMIT');

      await logAdminAction(req.admin?.admin_id, 'PLAN_UPGRADED', 'tenant', tenantId, {
        from_plan: currentPlanName,
        to_plan: nextPlan.name,
        remaining_days: remainingDays,
        extra_amount: extraAmount
      });

        const tenantRes = await client.query(
          `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.domain, t.plan_type, t.is_active, t.created_at, t.addons, t.gst_mode
           FROM tenants t
           WHERE t.id = $1`,
          [tenantId]
        );
      const subscriptionRes = await client.query(
        `SELECT s.payment_status, s.end_date, s.amount, s.plan_id, p.name AS plan_name
         FROM subscriptions s
         LEFT JOIN plans p ON p.id = s.plan_id
         WHERE s.tenant_id = $1
         ORDER BY s.end_date DESC NULLS LAST, s.id DESC
         LIMIT 1`,
        [tenantId]
      );
      const resolvedPlanType = subscriptionRes.rowCount > 0
        ? subscriptionRes.rows[0].plan_name
        : nextPlan.name;
        const planFeatures = tenantRes.rowCount > 0
          ? resolveFeatures({
              ...tenantRes.rows[0],
              plan_type: resolvedPlanType,
              addons: tenantRes.rows[0].addons || {}
            })
          : {};

      const tenant = tenantRes.rowCount > 0
        ? {
            ...tenantRes.rows[0],
            plan_features: planFeatures
          }
        : null;

      return jsonOk(res, {
        tenant_id: tenantId,
        from_plan: currentPlanName,
        to_plan: nextPlan.name,
        remaining_days: remainingDays,
        extra_amount: extraAmount,
        end_date: subscription.end_date,
        tenant,
        subscription: subscriptionRes.rowCount > 0 ? subscriptionRes.rows[0] : null
      });
  } catch (error) {
    await client.query('ROLLBACK');
    return jsonError(res, 500, 'PLAN_UPGRADE_FAILED', error.message);
  } finally {
    client.release();
  }
};

const renewTenantPlan = async (req, res) => {
  try {
    const tenantId = Number(req.params.tenant_id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const { payment_amount, payment_status, payment_method } = req.body || {};
    const allowedKeys = new Set([
      'payment_amount',
      'payment_status',
      'payment_method'
    ]);
    const unexpectedKeys = Object.keys(req.body || {}).filter((key) => !allowedKeys.has(key));
    if (unexpectedKeys.length > 0) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Only payment fields are allowed');
    }

    const tenantRes = await masterPool.query(
      `SELECT id, plan_type FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (tenantRes.rowCount === 0) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const currentSubscriptionRes = await masterPool.query(
      `SELECT id, plan_id, end_date, amount
       FROM subscriptions
       WHERE tenant_id = $1
       ORDER BY end_date DESC NULLS LAST, id DESC
       LIMIT 1`,
      [tenantId]
    );
    const currentSubscription =
      currentSubscriptionRes.rowCount > 0 ? currentSubscriptionRes.rows[0] : null;

    const planRes = currentSubscription?.plan_id
      ? await masterPool.query(
          `SELECT id, name, price, duration_days
           FROM plans
           WHERE id = $1 AND is_active = TRUE`,
          [currentSubscription.plan_id]
        )
      : await masterPool.query(
          `SELECT id, name, price, duration_days
           FROM plans
           WHERE LOWER(name) = LOWER($1) AND is_active = TRUE`,
          [tenantRes.rows[0].plan_type]
        );
    if (planRes.rowCount === 0) {
      return jsonError(res, 404, 'PLAN_NOT_FOUND', 'Plan not found');
    }
    const planRow = planRes.rows[0];

    const renewalWindow = await resolveRenewalWindow(
      currentSubscription?.end_date || null,
      planRow.duration_days
    );

    const normalizedAmount =
      payment_amount === undefined || payment_amount === null
        ? Number(planRow.price || 0)
        : Number(payment_amount);
    if (Number.isNaN(normalizedAmount)) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'payment_amount must be a number');
    }

    const normalizedStatus = payment_status ? payment_status.toString().trim().toLowerCase() : 'paid';

    const subscriptionRes = await masterPool.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, start_date, end_date, amount, payment_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, start_date, end_date, amount, payment_status`,
      [
        tenantId,
        planRow.id,
        renewalWindow.start_date,
        renewalWindow.end_date,
        normalizedAmount,
        normalizedStatus
      ]
    );

    await masterPool.query(
      `INSERT INTO subscription_payments (tenant_id, plan_id, amount, status, payment_method)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        tenantId,
        planRow.id,
        normalizedAmount,
        normalizedStatus,
        payment_method || null
      ]
    );

    await masterPool.query(
      `UPDATE tenants SET plan_type = $1 WHERE id = $2`,
      [planRow.name, tenantId]
    );

    await logAdminAction(req.admin?.admin_id, 'PLAN_RENEWED', 'tenant', tenantId, {
      plan_id: planRow.id,
      plan_name: planRow.name,
      amount: normalizedAmount,
      start_date: renewalWindow.start_date,
      end_date: renewalWindow.end_date
    });

    return jsonOk(res, {
      tenant_id: tenantId,
      plan_id: planRow.id,
      plan_name: planRow.name,
      start_date: renewalWindow.start_date,
      end_date: renewalWindow.end_date,
      subscription: subscriptionRes.rows[0]
    });
  } catch (error) {
    return jsonError(res, 500, 'PLAN_RENEW_FAILED', error.message);
  }
};

const getSubscriptionPayments = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const from = req.query.from?.toString().trim();
    const to = req.query.to?.toString().trim();
    const plan = req.query.plan?.toString().trim();

    const values = [];
    const where = [];
    if (from) {
      values.push(from);
      where.push(`sp.paid_at >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      where.push(`sp.paid_at <= $${values.length}`);
    }
    if (plan) {
      values.push(plan);
      where.push(`LOWER(p.name) = LOWER($${values.length})`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    if (!(await hasMasterTable('subscription_payments'))) {
      await logAdminAction(req.admin?.admin_id, 'SUBSCRIPTION_PAYMENTS_VIEWED', 'payment', null, {
        limit,
        offset,
        from: from || null,
        to: to || null,
        plan: plan || null
      });
      return jsonOk(res, { payments: [], limit, offset });
    }

    const result = await masterPool.query(
      `SELECT sp.id, sp.tenant_id, sp.amount, sp.status, sp.payment_method, sp.paid_at,
              t.shop_name, p.name AS plan_name
       FROM subscription_payments sp
       LEFT JOIN tenants t ON t.id = sp.tenant_id
       LEFT JOIN plans p ON p.id = sp.plan_id
       ${whereClause}
       ORDER BY sp.paid_at DESC NULLS LAST, sp.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    await logAdminAction(req.admin?.admin_id, 'SUBSCRIPTION_PAYMENTS_VIEWED', 'payment', null, {
      limit,
      offset,
      from: from || null,
      to: to || null,
      plan: plan || null
    });

    return jsonOk(res, { payments: result.rows, limit, offset });
  } catch (error) {
    return jsonError(res, 500, 'PAYMENTS_LIST_FAILED', error.message);
  }
};

const getSubscriptions = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const result = await masterPool.query(
      `SELECT s.id, s.tenant_id, s.start_date, s.end_date, s.amount, s.payment_status,
              t.shop_name, t.plan_type, t.is_active, p.name AS plan_name
       FROM subscriptions s
       JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN plans p ON p.id = s.plan_id
       ORDER BY s.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    await logAdminAction(req.admin?.admin_id, 'SUBSCRIPTIONS_VIEWED', 'subscription', null, {
      limit,
      offset
    });

    return jsonOk(res, { subscriptions: result.rows, limit, offset });
  } catch (error) {
    return jsonError(res, 500, 'SUBSCRIPTION_LIST_FAILED', error.message);
  }
};

const getRevenueReportHandler = async (req, res) => {
  try {
    const { from, to } = req.query;
    const report = await getRevenueReport({ from, to });
    await logAdminAction(req.admin?.admin_id, 'REVENUE_REPORT_VIEWED', 'report', null, {
      from: from || null,
      to: to || null
    });
    return jsonOk(res, { from: from || null, to: to || null, report });
  } catch (error) {
    return jsonError(res, 500, 'REVENUE_REPORT_FAILED', error.message);
  }
};

const getActivityLogs = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const type = req.query.type?.toString().trim().toLowerCase();

    const values = [];
    const where = [];
    if (type === 'updates_made') {
      values.push('%UPDATED%');
      values.push('%CREATED%');
      where.push(`(l.action ILIKE $${values.length - 1} OR l.action ILIKE $${values.length})`);
    }

    values.push(limit);
    values.push(offset);
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await masterPool.query(
      `SELECT l.id, l.admin_id, l.action, l.entity_type, l.entity_id, l.metadata, l.created_at,
              a.name AS admin_name, a.email AS admin_email
       FROM platform_activity_logs l
       LEFT JOIN platform_admins a ON a.id = l.admin_id
       ${whereClause}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    await logAdminAction(req.admin?.admin_id, 'ACTIVITY_LOGS_VIEWED', 'activity_log', null, {
      limit,
      offset,
      type: type || null
    });

    return jsonOk(res, { logs: result.rows, limit, offset });
  } catch (error) {
    return jsonError(res, 500, 'ACTIVITY_LOGS_FAILED', error.message);
  }
};

const getPlans = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const active =
      req.query.active === undefined ? undefined : req.query.active?.toString().toLowerCase() === 'true';

    const values = [];
    const where = [];
    if (active !== undefined) {
      values.push(active);
      where.push(`is_active = $${values.length}`);
    }

    values.push(limit);
    values.push(offset);

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await masterPool.query(
      `SELECT id, name, price, duration_days, is_active, created_at
       FROM plans
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    await logAdminAction(req.admin?.admin_id, 'PLANS_VIEWED', 'plan', null, {
      limit,
      offset,
      active: active ?? null
    });

    const plans = result.rows.map((row) => ({
      ...row,
      features: getPlanFeatures(row.name)
    }));

    return jsonOk(res, { plans, limit, offset });
  } catch (error) {
    return jsonError(res, 500, 'PLANS_LIST_FAILED', error.message);
  }
};

const getCreateTenantMeta = async (req, res) => {
  try {
    const plansRes = await masterPool.query(
      `SELECT name
       FROM plans
       WHERE is_active = TRUE
       ORDER BY created_at DESC, id DESC`
    );

    await logAdminAction(req.admin?.admin_id, 'CREATE_TENANT_META_VIEWED', 'tenant', null, {
      plans: plansRes.rowCount
    });

    const plans = plansRes.rows.map((row) => row.name);
    return jsonOk(res, { plans });
  } catch (error) {
    return jsonError(res, 500, 'CREATE_TENANT_META_FAILED', error.message);
  }
};

const getPlatformConfig = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');
    }

    const payload = {
      id: tenantId,
      shop_name: req.tenant?.shop_name ?? null,
      gst_mode: req.tenant?.gst_mode || 'INCLUSIVE',
      plan_features: req.featureFlags || {}
    };

    return jsonOk(res, payload);
  } catch (error) {
    return jsonError(res, 500, 'TENANT_CONFIG_FAILED', error.message);
  }
};

const normalizeHeader = (value) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const parseNumber = (value) => {
  if (value === undefined || value === null) return null;
  const cleaned = value.toString().replace(/[,₹$]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
};

const parseBoolean = (value) => {
  if (value === undefined || value === null) return null;
  const text = value.toString().trim().toLowerCase();
  if (!text) return null;
  if (['true', 'yes', 'y', '1'].includes(text)) return true;
  if (['false', 'no', 'n', '0'].includes(text)) return false;
  return null;
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else if (char !== '\r') {
        field += char;
      }
    }
  }

  row.push(field);
  if (row.length > 1 || row[0] !== '') {
    rows.push(row);
  }
  return rows;
};

const extractSheetId = (url) => {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

const decodeSheetTitle = (value) =>
  value
    .replace(/\\"/g, '"')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const getSheetNamesFromUrl = async (url) => {
  const sheetId = extractSheetId(url);
  if (!sheetId) return [];
  const editUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  const response = await axios.get(editUrl);
  const html = response.data?.toString() || '';
  const regex = /"title":"([^"]+)","sheetId":\d+/g;
  const names = new Set();
  let match = regex.exec(html);
  while (match) {
    names.add(decodeSheetTitle(match[1]));
    match = regex.exec(html);
  }
  return Array.from(names);
};

const buildCsvUrl = (sheetId, sheetName) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheetName
  )}`;

const importProductsFromGoogleSheet = async (req, res) => {
  try {
    const tenantId = Number(req.params.tenant_id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const sheetUrl = req.body?.sheetUrl || req.body?.url;
    if (!sheetUrl) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'sheetUrl is required');
    }

    const context = await resolveTenantContext(tenantId);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid Google Sheets URL');
    }

    let sheetNames = Array.isArray(req.body?.sheetNames) ? req.body.sheetNames : null;
    if (!sheetNames || sheetNames.length === 0) {
      sheetNames = await getSheetNamesFromUrl(sheetUrl);
    }
    if (!sheetNames || sheetNames.length === 0) {
      return jsonError(
        res,
        400,
        'VALIDATION_ERROR',
        'Unable to detect sheet names. Provide sheetNames in the request.'
      );
    }

    const errors = [];
    let insertedCount = 0;
    let skippedCount = 0;

    const headerAliases = {
      name: ['name', 'productname', 'product'],
      category: ['category', 'productcategory', 'group'],
      selling_price: ['sellingprice', 'selling_price', 'price', 'selling'],
      stock_quantity: ['stockquantity', 'stock', 'quantity', 'qty'],
      purchase_price: ['actualprice', 'purchase_price', 'cost', 'costprice'],
      company: ['company', 'brand', 'seller', 'vendor'],
      time_for_delivery: ['timefordelivery', 'deliverytime', 'leadtime'],
      is_weight_based: ['isweightbased', 'weightbased', 'is_weight_based', 'weightbased?'],
      barcode: ['barcode', 'bar_code', 'code', 'ean', 'upc']
    };

    const resolveHeaderIndex = (headers, aliases) => {
      for (const alias of aliases) {
        const index = headers.findIndex((h) => h === normalizeHeader(alias));
        if (index >= 0) return index;
      }
      return -1;
    };

    const barcodeColumnRes = await context.tenantPool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'barcode'
       LIMIT 1`
    );
    const hasBarcodeColumn = barcodeColumnRes.rowCount > 0;

    for (const sheetName of sheetNames) {
      const csvUrl = buildCsvUrl(sheetId, sheetName);
      const response = await axios.get(csvUrl);
      const rows = parseCsv(response.data?.toString() || '');
      if (rows.length === 0) continue;

      const headers = rows[0].map((h) => normalizeHeader(h));
      const nameIdx = resolveHeaderIndex(headers, headerAliases.name);
      const categoryIdx = resolveHeaderIndex(headers, headerAliases.category);
      const sellingIdx = resolveHeaderIndex(headers, headerAliases.selling_price);
      const stockIdx = resolveHeaderIndex(headers, headerAliases.stock_quantity);
      const purchaseIdx = resolveHeaderIndex(headers, headerAliases.purchase_price);
      const companyIdx = resolveHeaderIndex(headers, headerAliases.company);
      const deliveryIdx = resolveHeaderIndex(headers, headerAliases.time_for_delivery);
      const weightIdx = resolveHeaderIndex(headers, headerAliases.is_weight_based);
      const barcodeIdx = resolveHeaderIndex(headers, headerAliases.barcode);

        const missingColumns = [];
        if (nameIdx < 0) missingColumns.push('name');
        if (stockIdx < 0) missingColumns.push('stock_quantity');
        if (purchaseIdx < 0) missingColumns.push('purchase_price');
      if (missingColumns.length > 0) {
        errors.push({
          sheet: sheetName,
          row: 1,
          errors: [`Missing required columns: ${missingColumns.join(', ')}`]
        });
        continue;
      }

      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i];
        const rowNumber = i + 1;

        if (!row || row.every((cell) => !cell || cell.toString().trim() === '')) {
          skippedCount += 1;
          continue;
        }

        const name = row[nameIdx]?.toString().trim();
        const categoryRaw = categoryIdx >= 0 ? row[categoryIdx]?.toString().trim() : '';
        const category = categoryRaw ? categoryRaw : sheetName;
        const sellingPriceRaw = sellingIdx >= 0 ? parseNumber(row[sellingIdx]) : null;
        const stockQuantity = parseNumber(row[stockIdx]);
        const purchasePriceRaw = purchaseIdx >= 0 ? parseNumber(row[purchaseIdx]) : null;
        const company = companyIdx >= 0 ? row[companyIdx]?.toString().trim() : null;
        const timeForDelivery = deliveryIdx >= 0 ? parseNumber(row[deliveryIdx]) : null;
        const isWeightBased =
          weightIdx >= 0 ? parseBoolean(row[weightIdx]) ?? false : false;
        const barcodeValue =
          barcodeIdx >= 0 ? row[barcodeIdx]?.toString().trim() : null;
        const barcode = barcodeValue ? barcodeValue : null;

          const rowErrors = [];
          if (!name) rowErrors.push('name is required');
          if (purchasePriceRaw === null) rowErrors.push('purchase_price is required');
          if (stockQuantity === null) rowErrors.push('stock_quantity is required');

        if (rowErrors.length > 0) {
          errors.push({ sheet: sheetName, row: rowNumber, errors: rowErrors });
          continue;
        }

        try {
            const insertColumns = [
              'name',
              'category',
              'selling_price',
              'stock_quantity',
              'purchase_price',
              'company',
              'time_for_delivery',
              'is_weight_based'
            ];
            const insertValues = [
              name,
              category,
              sellingPriceRaw ?? 0,
              stockQuantity,
              purchasePriceRaw,
              company || null,
              timeForDelivery !== null ? Math.round(timeForDelivery) : null,
              isWeightBased
            ];
          if (hasBarcodeColumn) {
            insertColumns.push('barcode');
            insertValues.push(barcode);
          }
          if (branchId) {
            insertColumns.push('branch_id');
            insertValues.push(branchId);
          }
          const placeholders = insertValues.map((_, idx) => `$${idx + 1}`).join(', ');

          await context.tenantPool.query(
            `INSERT INTO products (${insertColumns.join(', ')})
             VALUES (${placeholders})`,
            insertValues
          );
          insertedCount += 1;
        } catch (error) {
          errors.push({
            sheet: sheetName,
            row: rowNumber,
            errors: [error.message]
          });
        }
      }
    }

    await logAdminAction(req.admin?.admin_id, 'PRODUCTS_BULK_IMPORTED', 'product', null, {
      tenant_id: tenantId,
      sheets: sheetNames
    });

    return jsonOk(res, {
      tenant_id: tenantId,
      sheetNames,
      insertedCount,
      skippedCount,
      errorCount: errors.length,
      errors
    });
  } catch (error) {
    return jsonError(res, 500, 'PRODUCT_IMPORT_FAILED', error.message);
  }
};

const createTenantUser = async (req, res) => {
  try {
    const tenantId = Number(req.params.tenant_id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password || !role) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'name, email, password, role are required');
    }

    const normalizedRole = role.toString().trim().toLowerCase();
    if (!['admin', 'staff'].includes(normalizedRole)) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'role must be admin or staff');
    }

    const context = await resolveTenantContext(tenantId);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const contextPlanFeatures = resolveFeatures(context.tenant || {});
    const maxUsers = Number(contextPlanFeatures.max_users || 0);
    if (maxUsers > 0) {
      const countRes = await context.tenantPool.query(
        'SELECT COUNT(*)::int AS total FROM users'
      );
      const totalUsers = Number(countRes.rows[0]?.total || 0);
      if (totalUsers >= maxUsers) {
        return jsonError(res, 403, 'USER_LIMIT_REACHED', 'User limit reached for this plan');
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await context.tenantPool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [name, email.toString().trim().toLowerCase(), hashedPassword, normalizedRole]
    );

    await logAdminAction(req.admin?.admin_id, 'TENANT_USER_CREATED', 'user', result.rows[0].id, {
      tenant_id: tenantId,
      email: result.rows[0].email,
      role: result.rows[0].role
    });

    return jsonOk(res, { user: result.rows[0] }, 'User created');
  } catch (error) {
    if (error.code === '23505') {
      return jsonError(res, 409, 'USER_EXISTS', 'Email already exists');
    }
    return jsonError(res, 500, 'USER_CREATE_FAILED', error.message);
  }
};

const getTenantUsers = async (req, res) => {
  try {
    const tenantId = Number(req.params.tenant_id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const context = await resolveTenantContext(tenantId);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const result = await context.tenantPool.query(
      `SELECT id, name, email, role, created_at
       FROM users
       ORDER BY id DESC`
    );

    await logAdminAction(req.admin?.admin_id, 'TENANT_USERS_VIEWED', 'user', null, {
      tenant_id: tenantId
    });

    return jsonOk(res, { users: result.rows });
  } catch (error) {
    return jsonError(res, 500, 'TENANT_USERS_FAILED', error.message);
  }
};

const updateTenantUserRole = async (req, res) => {
  try {
    const tenantId = Number(req.params.tenant_id || req.body?.tenant_id || req.query?.tenant_id);
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'tenant_id is required');
    }

    const userId = Number(req.params.id);
    if (!userId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid user id');
    }

    const { role } = req.body || {};
    if (!role) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'role is required');
    }

    const normalizedRole = role.toString().trim().toLowerCase();
    if (!['admin', 'staff'].includes(normalizedRole)) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'role must be admin or staff');
    }

    const context = await resolveTenantContext(tenantId);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const result = await context.tenantPool.query(
      `UPDATE users
       SET role = $1
       WHERE id = $2
       RETURNING id, name, email, role, created_at`,
      [normalizedRole, userId]
    );

    if (result.rowCount === 0) {
      return jsonError(res, 404, 'USER_NOT_FOUND', 'User not found');
    }

    await logAdminAction(req.admin?.admin_id, 'TENANT_USER_ROLE_UPDATED', 'user', userId, {
      tenant_id: tenantId,
      role: normalizedRole
    });

    return jsonOk(res, { user: result.rows[0] }, 'User role updated');
  } catch (error) {
    return jsonError(res, 500, 'USER_ROLE_UPDATE_FAILED', error.message);
  }
};

const getTenantBranches = async (req, res) => {
  try {
    const tenantId = String(req.params.tenant_id || '').trim();
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const context = await resolveTenantContext(tenantId);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }
    const branchId = normalizeBranchId(req.body?.branch_id || req.query?.branch_id);

    const result = await context.tenantPool.query(
      `SELECT id, name, location, created_at, subscription_plan, max_devices_allowed
       FROM branches
       ORDER BY created_at DESC`
    );

    await logAdminAction(req.admin?.admin_id, 'TENANT_BRANCHES_VIEWED', 'branch', null, {
      tenant_id: tenantId
    });

    return jsonOk(res, { branches: result.rows }, 'Branches fetched');
  } catch (error) {
    return jsonError(res, 500, 'TENANT_BRANCHES_FAILED', error.message);
  }
};

const createTenantBranch = async (req, res) => {
  try {
    const tenantId = String(req.params.tenant_id || '').trim();
    if (!tenantId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant id');
    }

    const context = await resolveTenantContext(tenantId);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const name = String(req.body?.name || '').trim();
    const location = req.body?.location ? String(req.body.location).trim() : null;
    const planInput = req.body?.subscription_plan || req.body?.plan;
    const normalizedPlan = normalizePlan(planInput || context?.tenant?.plan_type || 'basic');
    const maxDevicesRaw = req.body?.max_devices_allowed;
    const maxDevicesAllowed =
      maxDevicesRaw === null || maxDevicesRaw === undefined
        ? resolvePlanDeviceLimit(normalizedPlan)
        : Number(maxDevicesRaw);
    if (!name) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'name is required');
    }

    const result = await context.tenantPool.query(
      `INSERT INTO branches (name, location, subscription_plan, max_devices_allowed)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, location, created_at, subscription_plan, max_devices_allowed`,
      [
        name,
        location || null,
        normalizedPlan,
        Number.isFinite(maxDevicesAllowed) ? maxDevicesAllowed : null
      ]
    );

    await logAdminAction(req.admin?.admin_id, 'TENANT_BRANCH_CREATED', 'branch', null, {
      tenant_id: tenantId,
      name
    });

    return jsonOk(res, { branch: result.rows[0] }, 'Branch created');
  } catch (error) {
    return jsonError(res, 500, 'TENANT_BRANCH_CREATE_FAILED', error.message);
  }
};

const updateTenantBranch = async (req, res) => {
  try {
    const tenantId = String(req.params.tenant_id || '').trim();
    const branchId = String(req.params.branch_id || '').trim();
    if (!tenantId || !branchId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid tenant or branch id');
    }

    const context = await resolveTenantContext(tenantId);
    if (!context) {
      return jsonError(res, 404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const maxDevicesRaw = req.body?.max_devices_allowed;
    const maxDevicesAllowed =
      maxDevicesRaw === '' || maxDevicesRaw === null || maxDevicesRaw === undefined
        ? null
        : Number(maxDevicesRaw);

    const result = await context.tenantPool.query(
      `UPDATE branches
       SET max_devices_allowed = $1
       WHERE id = $2
       RETURNING id, name, location, created_at, subscription_plan, max_devices_allowed`,
      [Number.isFinite(maxDevicesAllowed) ? maxDevicesAllowed : null, branchId]
    );

    if (result.rowCount === 0) {
      return jsonError(res, 404, 'BRANCH_NOT_FOUND', 'Branch not found');
    }

    await logAdminAction(req.admin?.admin_id, 'TENANT_BRANCH_UPDATED', 'branch', branchId, {
      tenant_id: tenantId,
      max_devices_allowed: Number.isFinite(maxDevicesAllowed) ? maxDevicesAllowed : null
    });

    return jsonOk(res, { branch: result.rows[0] }, 'Branch updated');
  } catch (error) {
    return jsonError(res, 500, 'TENANT_BRANCH_UPDATE_FAILED', error.message);
  }
};

module.exports = {
  createTenantHandler,
  getDashboard: getDashboardHandler,
  getTenants,
  getTenantById,
  updateTenant,
  updateTenantByParam,
  updatePlan,
  getSubscriptionPayments,
  getSubscriptions,
  getRevenueReport: getRevenueReportHandler,
  getActivityLogs,
  getPlans,
  getCreateTenantMeta,
  getReports: getReportsHandler,
  getGlobalReports: getGlobalReportsHandler,
  getSubscriptionsSummary,
  getPlatformConfig,
  importProductsFromGoogleSheet,
  updateTenantPlanAndFlags,
  updateTenantAddons,
  createTenantUser,
  getTenantUsers,
  updateTenantUserRole,
  upgradeTenantPlan,
  renewTenantPlan,
  getTenantBranches,
  createTenantBranch,
  updateTenantBranch
};

