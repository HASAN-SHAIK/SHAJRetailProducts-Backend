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
    const loginStart = controller.indexOf('const login = async');
    const refreshStart = controller.indexOf('const refresh = async');
    const loginBody = controller.slice(loginStart, refreshStart);
    const disabled = loginBody.indexOf('tenant.is_active === false');
    const tenantPool = loginBody.indexOf('getTenantPool(tenant.database_name)');
    const issueSession = loginBody.indexOf('issueAuthSession({');

    expect(disabled).toBeGreaterThan(-1);
    expect(tenantPool).toBeGreaterThan(disabled);
    expect(issueSession).toBeGreaterThan(disabled);
  });

  test('refresh rejects and clears cookies for a disabled tenant before consuming predecessor token', () => {
    const controller = source('src/controllers/authController.js');
    const refreshStart = controller.indexOf('const refresh = async');
    const getLoginStart = controller.indexOf('const getLogin = async');
    const refreshBody = controller.slice(refreshStart, getLoginStart);
    const disabled = refreshBody.indexOf('tenant.is_active === false');
    const clearCookies = refreshBody.indexOf('clearSessionCookies(res)', disabled);
    const rotate = refreshBody.indexOf('consumeAndRotateRefreshToken');

    expect(disabled).toBeGreaterThan(-1);
    expect(clearCookies).toBeGreaterThan(disabled);
    expect(rotate).toBeGreaterThan(clearCookies);
    expect(refreshBody).toContain("return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled')");
  });

  test('platform tenant mutations invalidate cached tenant authority', () => {
    const controller = source('src/controllers/platformController.js');
    expect(controller).toContain('const clearTenantRuntimeCaches = (tenantId) => {');
    expect(controller).toContain('clearCachedTenant(tenantId)');
    expect(controller).toContain('clearCachedSubscription(tenantId)');
    expect(controller).toContain('clearTenantRuntimeCaches(tenantId)');
  });
});
