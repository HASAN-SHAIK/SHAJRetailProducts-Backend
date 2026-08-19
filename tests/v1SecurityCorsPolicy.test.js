const { createCorsOptions } = require('../src/security/corsPolicy');

const evaluateOrigin = (options, origin) =>
  new Promise((resolve) => {
    options.origin(origin, (error, allowed) => resolve({ error, allowed }));
  });

describe('V1 Central credentialed CORS policy', () => {
  test('production rejects wildcard credentialed origin configuration', () => {
    expect(() =>
      createCorsOptions({
        environment: 'production',
        rawCorsOrigins: '*',
      })
    ).toThrow('CORS_ORIGINS must not contain * in production');
  });

  test('production accepts only explicitly configured browser origins', async () => {
    const options = createCorsOptions({
      environment: 'production',
      rawCorsOrigins: 'https://admin.example.test/, https://tenant.example.test',
    });

    expect(await evaluateOrigin(options, 'https://admin.example.test')).toEqual({
      error: null,
      allowed: true,
    });
    expect(await evaluateOrigin(options, 'https://tenant.example.test')).toEqual({
      error: null,
      allowed: true,
    });

    const rejected = await evaluateOrigin(options, 'https://evil.example.test');
    expect(rejected.allowed).toBeUndefined();
    expect(rejected.error).toBeInstanceOf(Error);
    expect(rejected.error.message).toBe('Not allowed by CORS');
  });

  test('non-browser machine requests without Origin remain permitted', async () => {
    const options = createCorsOptions({
      environment: 'production',
      rawCorsOrigins: 'https://tenant.example.test',
    });

    expect(await evaluateOrigin(options, undefined)).toEqual({ error: null, allowed: true });
  });

  test('development may explicitly opt into wildcard origins', async () => {
    const options = createCorsOptions({ environment: 'development', rawCorsOrigins: '*' });
    expect(await evaluateOrigin(options, 'http://localhost:3000')).toEqual({
      error: null,
      allowed: true,
    });
  });
});
