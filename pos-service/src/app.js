const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const healthRoutes = require('./modules/health/routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ level: env.logLevel }));
  app.use('/api/v1', healthRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  return app;
}
module.exports = { createApp };
