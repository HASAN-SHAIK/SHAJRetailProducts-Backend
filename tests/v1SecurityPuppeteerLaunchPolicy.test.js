const { buildPuppeteerLaunchOptions } = require('../src/security/puppeteerLaunchPolicy');

describe('V1 Puppeteer launch security', () => {
  test('production keeps Chromium sandboxing enabled by default', () => {
    expect(buildPuppeteerLaunchOptions({
      environment: 'production',
      allowNoSandbox: undefined,
    })).toEqual({
      headless: 'new',
      args: [],
    });
  });

  test('production rejects an explicit no-sandbox override', () => {
    expect(() => buildPuppeteerLaunchOptions({
      environment: 'production',
      allowNoSandbox: 'true',
    })).toThrow('PUPPETEER_ALLOW_NO_SANDBOX cannot be enabled in production');
  });

  test('non-production keeps legacy no-sandbox compatibility unless explicitly disabled', () => {
    expect(buildPuppeteerLaunchOptions({
      environment: 'development',
      allowNoSandbox: undefined,
    }).args).toEqual(['--no-sandbox', '--disable-setuid-sandbox']);

    expect(buildPuppeteerLaunchOptions({
      environment: 'development',
      allowNoSandbox: 'false',
    }).args).toEqual([]);
  });
});
