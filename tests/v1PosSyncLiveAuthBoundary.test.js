const http = require('http');

process.env.NODE_ENV = 'test';
process.env.APP_ENVIRONMENT = 'test';
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';

describe('V1 POS sync live machine-auth boundary', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  test('real app listener rejects an unauthenticated POS sync event before request validation', async () => {
    const app = require('../src/App');
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });

    const address = server.address();
    const body = JSON.stringify({});
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: '/api/v1/sync/events',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on('error', reject);
      req.end(body);
    });

    expect(response).toEqual({
      status: 401,
      body: {
        code: 'POS_SYNC_UNAUTHORIZED',
        message: 'Missing POS sync credentials',
      },
    });
  });
});
