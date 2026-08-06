const env = require('./config/env');
const { migrate } = require('./db/migrate');
const { createApp } = require('./app');

migrate();
const server = createApp().listen(env.port, env.host, () => {
  console.log(`POS service listening at http://${env.host}:${env.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
