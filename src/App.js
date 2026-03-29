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
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

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
