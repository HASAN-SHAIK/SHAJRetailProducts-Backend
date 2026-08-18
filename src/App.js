const express = require('express');
const cors = require('cors');
const platformRoutes = require('./routes/platform.routes');
const platformAuthRoutes = require('./routes/platform.auth.routes');
const tenantRoutes = require('./routes/tenant.routes');
const authRoutes = require('./routes/authRoutes');
const posRegistrationPublicRoutes = require('./routes/posRegistrationPublicRoutes');
const app = express();
const cookieParser = require('cookie-parser');
const { tenantAuthMiddleware } = require('./middleware/tenantAuthMiddleware');
const { branchDeviceGuard } = require('./middleware/branchDeviceGuard');
const { adminAuthMiddleware } = require('./middleware/adminAuthMiddleware');
const { subscriptionMiddleware } = require('./middleware/subscription');
const { mergeFeatureFlags } = require('./middleware/featureFlags');
const { attachAuditDbContext } = require('./middleware/auditDbContext');
const { errorHandler } = require('./middleware/errorHandler');
const { apiV1AuthRouter, apiV1Router, swaggerRoutes } = require('./api/v1');
const posSyncRoutes = require('./api/v1/modules/sync/posSync.routes');
const { getTenantMe, getPlatformBanner } = require('./controllers/tenantController');
const { bootstrapMasterDatabase } = require('./services/masterBootstrap');
const { startPoolWarmup } = require('./services/poolWarmup');
const { startStockConsistencyJob } = require('./services/stockConsistencyJob');
const { startOwnerDailyDigestJob } = require('./services/ownerDailyDigestJob');
const { startSyncMessaging } = require('./services/syncMessagingBootstrap');
const masterPool = require('./db/masterPool');
require('dotenv').config();

app.set('trust proxy', 1);
app.use(cookieParser());
const rawCorsOrigins = process.env.CORS_ORIGINS;
const allowedOrigins = rawCorsOrigins
  ? rawCorsOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [process.env.FRONTEND_ADMIN_URL, process.env.FRONTEND_TENANT_URL].filter(Boolean);
const allowAllOrigins = allowedOrigins.includes('*');
const APP_ENVIRONMENT = process.env.APP_ENVIRONMENT || process.env.NODE_ENV || 'development';
const isTestRuntime = () => APP_ENVIRONMENT === 'test' || process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
const PORT = process.env.APP_PORT || process.env.PORT || 5000;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowAllOrigins || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  })
);
app.use(express.json({ limit: '5mb' }));

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getWindowMinutes = () => ({
  start:
    toNumber(process.env.HEALTH_WARMUP_START_HOUR, 0) * 60 +
    toNumber(process.env.HEALTH_WARMUP_START_MINUTE, 0),
  end:
    toNumber(process.env.HEALTH_WARMUP_END_HOUR, 23) * 60 +
    toNumber(process.env.HEALTH_WARMUP_END_MINUTE, 59),
});

const isWithinWarmupWindow = () => {
  if (!toBoolean(process.env.HEALTH_WARMUP_WINDOW_ENABLED, false)) {
    return true;
  }

  const offsetMinutes = toNumber(process.env.HEALTH_WARMUP_TZ_OFFSET_MINUTES, 0);
  const nowUtcMs = Date.now();
  const localMs = nowUtcMs + offsetMinutes * 60 * 1000;
  const localDate = new Date(localMs);
  const nowMinutes = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  const { start, end } = getWindowMinutes();

  if (start === end) return true;
  if (start < end) {
    return nowMinutes >= start && nowMinutes < end;
  }
  return nowMinutes >= start || nowMinutes < end;
};

const isWarmupAuthorized = (req) => {
  const expectedKey = process.env.HEALTH_WARMUP_KEY;
  if (!expectedKey) return false;
  const providedKey = req.query?.key || req.headers['x-warmup-key'];
  return typeof providedKey === 'string' && providedKey === expectedKey;
};

const isWarmupRequested = (req) => {
  const query = req.query || {};
  const warmDbValue = query.warm_db ?? query.db;
  return String(warmDbValue || '0') === '1';
};

const performHealthWarmup = async () => {
  await masterPool.query('SELECT 1');
};

const handleHealth = async (req, res) => {
  const response = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db: {
      warm_requested: false,
      warmed: false,
      window_enabled: toBoolean(process.env.HEALTH_WARMUP_WINDOW_ENABLED, false),
      reason: 'not_requested',
    },
  };

  if (!isWarmupRequested(req)) {
    return res.status(200).json(response);
  }

  response.db.warm_requested = true;

  if (!isWarmupAuthorized(req)) {
    response.db.reason = 'unauthorized';
    return res.status(200).json(response);
  }

  if (!isWithinWarmupWindow()) {
    response.db.reason = 'outside_window';
    return res.status(200).json(response);
  }

  try {
    await performHealthWarmup();
    response.db.warmed = true;
    response.db.reason = 'warmed';
    return res.status(200).json(response);
  } catch (error) {
    response.status = 'degraded';
    response.db.reason = 'query_failed';
    return res.status(503).json(response);
  }
};

const handleReady = async (_req, res) => {
  try {
    await masterPool.query('SELECT 1');
    return res.status(200).json({ status: 'ready' });
  } catch (_error) {
    return res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
  }
};

app.get('/health', handleHealth);
app.get('/api/health', handleHealth);
app.get('/ready', handleReady);
app.get('/api/ready', handleReady);

// Public routes
app.use('/platform/auth', platformAuthRoutes);
app.use('/platform', adminAuthMiddleware, platformRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', apiV1AuthRouter);
app.use('/api/v1/docs', swaggerRoutes);
// First-run POS registration is intentionally available before tenant JWT/device
// authorization. It can only create/poll a pending request; branch assignment is
// performed later by an authenticated tenant admin.
app.use('/api/v1/pos-registration', posRegistrationPublicRoutes);
// POS-to-central machine sync uses dedicated tenant/device credentials rather
// than an interactive tenant JWT. Mount it before the JWT-protected v1 router.
app.use('/api/v1/sync', posSyncRoutes);
app.use('/api/v1', tenantAuthMiddleware, branchDeviceGuard, subscriptionMiddleware, mergeFeatureFlags, attachAuditDbContext, apiV1Router);
app.use('/api', tenantAuthMiddleware, branchDeviceGuard, subscriptionMiddleware, mergeFeatureFlags, attachAuditDbContext, tenantRoutes);
app.get('/api/banner', tenantAuthMiddleware, mergeFeatureFlags, getPlatformBanner);
app.get('/tenant/me', tenantAuthMiddleware, mergeFeatureFlags, getTenantMe);
app.get('/api/tenant/me', tenantAuthMiddleware, mergeFeatureFlags, getTenantMe);

app.get('/', (req, res) => {
  res.send('SHAJ NextGen Technologies API is running...');
});

// Start server
app.use(errorHandler);

const startServer = async () => {
  try {
    await bootstrapMasterDatabase();
  } catch (error) {
    console.error('Master DB bootstrap skipped:', error.message || error);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  startPoolWarmup();
  if (!isTestRuntime()) {
    startStockConsistencyJob();
    startOwnerDailyDigestJob();
    startSyncMessaging().catch((error) => {
      console.error('Sync messaging bootstrap failed:', error.message || error);
    });
  }
};

if (!isTestRuntime()) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = app;