const http = require('http');

process.env.NODE_ENV = 'test';
process.env.APP_ENVIRONMENT = 'test';
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';

const closeLoadedPool = async (modulePath) => {
  const resolved = require.resolve(modulePath);
  const loaded = require.cache[resolved]?.exports;
  if (loaded && typeof loaded.end === 'function') {
    await loaded.end();
  }
};

const request = ({ port, path }) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw }));
      }
    );
    req.on('error', reject);
    req.end();
  });

describe('V1 legacy returns unauthorized runtime boundary', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  afterAll(async () => {
    await closeLoadedPool('../src/db/masterPool');
    const adminResolved = require.resolve('../src/db/adminPool');
    if (require.cache[adminResolved]) await closeLoadedPool('../src/db/adminPool');
  });

  test('real app listener rejects unauthenticated return history reads and remains healthy', async () => {
    const app = require('../src/App');
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });

    const { port } = server.address();
    const rejected = await request({ port, path: '/api/returns' });

    expect(rejected.status).toBe(401);
    expect(rejected.headers['content-type']).toMatch(/application\/json/);
    expect(rejected.headers['x-request-id']).toBeTruthy();
    expect(JSON.parse(rejected.raw)).toMatchObject({
      success: false,
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
    });

    const health = await request({ port, path: '/health' });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.raw)).toMatchObject({ status: 'ok' });
  });
});
