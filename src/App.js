const express = require('express');
const cors = require('cors');
const platformRoutes = require('./routes/platform.routes');
const platformAuthRoutes = require('./routes/platform.auth.routes');
const tenantRoutes = require('./routes/tenant.routes');
const authRoutes = require('./routes/authRoutes');
const app = express();
const cookieParser = require('cookie-parser');
const { tenantAuthMiddleware } = require('./middleware/tenantAuthMiddleware');
const { branchDeviceGuard } = require('./middleware/branchDeviceGuard');
const { adminAuthMiddleware } = require('./middleware/adminAuthMiddleware');
const { subscriptionMiddleware } = require('./middleware/subscription');
const { mergeFeatureFlags } = require('./middleware/featureFlags');
const { errorHandler } = require('./middleware/errorHandler');
const { getTenantMe, getPlatformBanner } = require('./controllers/tenantController');
const { bootstrapMasterDatabase } = require('./services/masterBootstrap');
const { startPoolWarmup } = require('./services/poolWarmup');
const masterPool = require('./db/masterPool');
require('dotenv').config();

app.set('trust proxy', 1);
app.use(cookieParser());
const rawCorsOrigins = process.env.CORS_ORIGINS;
const allowedOrigins = rawCorsOrigins
  ? rawCorsOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [process.env.FRONTEND_ADMIN_URL, process.env.FRONTEND_TENANT_URL].filter(Boolean);
const allowAllOrigins = allowedOrigins.includes('*');
const PORT = process.env.PORT || 5000;

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

const parseBoolEnv = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parseNumberEnv = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeMinuteOfDay = (minute) => {
  const fullDay = 24 * 60;
  const mod = minute % fullDay;
  return mod < 0 ? mod + fullDay : mod;
};

const resolveWarmupWindowState = () => {
  const enabled = parseBoolEnv(process.env.HEALTH_WARMUP_WINDOW_ENABLED, false);
  if (!enabled) {
    return { enabled: false, withinWindow: true, reason: null, nowMinute: null, startMinute: null, endMinute: null };
  }

  const tzOffsetMinutes = parseNumberEnv(process.env.HEALTH_WARMUP_TZ_OFFSET_MINUTES, 0);
  const startHour = parseNumberEnv(process.env.HEALTH_WARMUP_START_HOUR, 0);
  const startMinuteRaw = parseNumberEnv(process.env.HEALTH_WARMUP_START_MINUTE, 0);
  const endHour = parseNumberEnv(process.env.HEALTH_WARMUP_END_HOUR, 24);
  const endMinuteRaw = parseNumberEnv(process.env.HEALTH_WARMUP_END_MINUTE, 0);

  const startMinute = normalizeMinuteOfDay(startHour * 60 + startMinuteRaw);
  const endMinute = normalizeMinuteOfDay(endHour * 60 + endMinuteRaw);
  const nowUtc = new Date();
  const nowMinute = normalizeMinuteOfDay(nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes() + tzOffsetMinutes);

  let withinWindow = true;
  if (startMinute === endMinute) {
    withinWindow = true;
  } else if (startMinute < endMinute) {
    withinWindow = nowMinute >= startMinute && nowMinute < endMinute;
  } else {
    withinWindow = nowMinute >= startMinute || nowMinute < endMinute;
  }

  return {
    enabled: true,
    withinWindow,
    reason: withinWindow ? null : 'outside_window',
    nowMinute,
    startMinute,
    endMinute,
    tzOffsetMinutes
  };
};

const resolveWarmupRequest = (req) => {
  const wantsDbWarmup = ['1', 'true', 'yes'].includes(
    String(req.query?.warm_db || req.query?.db || '').trim().toLowerCase()
  );
  const configuredKey = String(process.env.HEALTH_WARMUP_KEY || '').trim();
  if (!wantsDbWarmup) {
    return { allowed: false, reason: 'disabled' };
  }
  if (!configuredKey) {
    return { allowed: false, reason: 'missing_server_key' };
  }
  const providedKey = String(req.query?.key || req.headers['x-warmup-key'] || '').trim();
  if (!providedKey || providedKey !== configuredKey) {
    return { allowed: false, reason: 'invalid_key' };
  }
  const windowState = resolveWarmupWindowState();
  if (!windowState.withinWindow) {
    return { allowed: false, reason: windowState.reason, window: windowState };
  }
  return { allowed: true, reason: null, window: windowState };
};

const healthHandler = async (req, res) => {
  const dbWarmup = resolveWarmupRequest(req);
  let db = { warmed: false, reason: dbWarmup.reason, window: dbWarmup.window || resolveWarmupWindowState() };

  if (dbWarmup.allowed) {
    try {
      await masterPool.query('SELECT 1');
      db = { warmed: true, reason: null, window: dbWarmup.window || resolveWarmupWindowState() };
    } catch (error) {
      return res.status(503).json({
        status: 'degraded',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        db: { warmed: false, reason: 'query_failed', window: dbWarmup.window || resolveWarmupWindowState() }
      });
    }
  }

  return res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Public routes
app.use('/platform/auth', platformAuthRoutes);
app.use('/platform', adminAuthMiddleware, platformRoutes);

app.use('/api/auth', authRoutes);
app.use('/api', tenantAuthMiddleware, branchDeviceGuard, subscriptionMiddleware, mergeFeatureFlags, tenantRoutes);
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
};

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;
