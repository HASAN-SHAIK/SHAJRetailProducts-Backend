const legacyAuthRouter = require('../src/routes/authRoutes');
const v1AuthRouter = require('../src/api/v1/modules/auth/auth.routes');

const routePaths = (router) =>
  router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: layer.route.methods }));

describe('V1 tenant user registration authority boundary', () => {
  test('legacy public auth router exposes no tenant-user registration endpoint', () => {
    const routes = routePaths(legacyAuthRouter);
    expect(routes.some((route) => route.path === '/register' && route.methods.post)).toBe(false);
    expect(routes.some((route) => route.path === '/login' && route.methods.post)).toBe(true);
    expect(routes.some((route) => route.path === '/refresh' && route.methods.post)).toBe(true);
  });

  test('versioned public auth router exposes no tenant-user registration endpoint', () => {
    const routes = routePaths(v1AuthRouter);
    expect(routes.some((route) => route.path === '/register' && route.methods.post)).toBe(false);
    expect(routes.some((route) => route.path === '/login' && route.methods.post)).toBe(true);
    expect(routes.some((route) => route.path === '/refresh' && route.methods.post)).toBe(true);
  });
});
