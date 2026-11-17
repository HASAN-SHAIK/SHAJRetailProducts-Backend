const fs = require('fs');
const path = require('path');

const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('V1 tenant deactivation authentication authority', () => {
  test('protected tenant middleware resolves current Central tenant state instead of JWT tenant snapshot', () => {
    const middleware = source('src/middleware/authTenant.js');
    expect(middleware).toContain('const context = await resolveTenantContext(verified.tenant_id)');
    expect(middleware).not.toContain('resolveTenantContextFromToken');
    expect(middleware).toContain("return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled')");
  });

  test('login rejects a disabled tenant before tenant user/session work', () => {
    const controller = source('src/controllers/authController.js');
    // Shared by web and mobile login: tenant authority is checked inside authenticateTenantLogin,
    // and both login entry points only issue a session from its (non-null) result.
    const authStart = controller.indexOf('const authenticateTenantLogin = async');
    const loginStart = controller.indexOf('const login = async');
    const mobileLoginStart = controller.indexOf('const mobileLogin = async');
    const rotateStart = controller.indexOf('const rotateRefreshSession = async');
    const authBody = controller.slice(authStart, loginStart);
    const disabled = authBody.indexOf('tenant.is_active === false');
    const tenantPool = authBody.indexOf('getTenantPool(tenant.database_name)');

    expect(disabled).toBeGreaterThan(-1);
    expect(tenantPool).toBeGreaterThan(disabled);

    for (const body of [controller.slice(loginStart, mobileLoginStart), controller.slice(mobileLoginStart, rotateStart)]) {
      const authenticate = body.indexOf('authenticateTenantLogin(req, res)');
      const issue = body.search(/issue(Mobile)?AuthSession\(/);
      expect(authenticate).toBeGreaterThan(-1);
      expect(issue).toBeGreaterThan(authenticate);
    }
  });

  test('refresh rejects and clears cookies for a disabled tenant before consuming predecessor token', () => {
    const controller = source('src/controllers/authController.js');
    // Web and mobile refresh share rotateRefreshSession; the web route opts in to clearing cookies.
    const rotateStart = controller.indexOf('const rotateRefreshSession = async');
    const refreshStart = controller.indexOf('const refresh = async');
    const mobileRefreshStart = controller.indexOf('const mobileRefresh = async');
    const rotateBody = controller.slice(rotateStart, refreshStart);
    const disabled = rotateBody.indexOf('tenant.is_active === false');
    const clearCookies = rotateBody.indexOf('clearSessionCookies(res)', disabled);
    const rotate = rotateBody.indexOf('consumeAndRotateRefreshToken');

    expect(disabled).toBeGreaterThan(-1);
    expect(clearCookies).toBeGreaterThan(disabled);
    expect(rotate).toBeGreaterThan(clearCookies);
    expect(rotateBody).toContain("jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled')");
    expect(controller.slice(refreshStart, mobileRefreshStart)).toContain('clearCookiesOnDisabled: true');
  });

  test('platform tenant mutations invalidate cached tenant authority', () => {
    const controller = source('src/controllers/platformController.js');
    expect(controller).toContain('const clearTenantRuntimeCaches = (tenantId) => {');
    expect(controller).toContain('clearCachedTenant(tenantId)');
    expect(controller).toContain('clearCachedSubscription(tenantId)');
    expect(controller).toContain('clearTenantRuntimeCaches(tenantId)');
  });
});
