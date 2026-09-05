const http = require('http');

process.env.NODE_ENV = 'test';
process.env.APP_ENVIRONMENT = 'test';
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';

const closeLoadedPool = async (modulePath) => {
  const resolved = require.resolve(modulePath);
  const loaded = require.cache[resolved]?.exports;
  if (loaded && typeof loaded.end === 'function') await loaded.end();
};

const request = ({ port, path, method = 'GET', body, headers = {} }) =>
  new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

describe('V1 oversized JSON runtime resilience', () => {
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

  test('real app listener rejects JSON above 5mb and remains healthy', async () => {
    const app = require('../src/App');
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });

    const { port } = server.address();
    const oversized = JSON.stringify({ payload: 'x'.repeat(5 * 1024 * 1024 + 1024) });
    const rejected = await request({
      port,
      path: '/api/v1/sync/events',
      method: 'POST',
      body: oversized,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(oversized),
      },
    });

    expect(rejected.status).toBe(413);
    expect(rejected.headers['content-type']).toMatch(/application\/json/);
    expect(rejected.headers['x-request-id']).toBeTruthy();
    expect(JSON.parse(rejected.raw)).toMatchObject({ code: 'entity.too.large' });

    const health = await request({ port, path: '/health' });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.raw)).toMatchObject({ status: 'ok' });
  });
});
