const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('V1 dependency security residual policy', () => {
  test('runtime-reachable high-advisory dependencies have explicit V1 mitigations', () => {
    const manifest = JSON.parse(read('package.json'));
    const policy = read('docs/V1_SECURITY_DEPENDENCY_RESIDUALS.md');

    for (const dependency of ['nodemailer', 'puppeteer', 'xlsx']) {
      expect(manifest.dependencies[dependency]).toBeTruthy();
      expect(policy).toContain(`\`${dependency}\``);
    }

    expect(read('src/security/supportNotificationPolicy.js')).toContain('SUPPORT_CASE_INTAKE_EMAIL');
    expect(read('src/security/puppeteerLaunchPolicy.js')).toMatch(/sandbox/i);
    expect(read('src/security/productImportUploadPolicy.js')).toMatch(/signature|content/i);
    expect(read('src/services/imports.service.js')).toMatch(/500|MAX_IMPORT|rows/i);
  });

  test('verified-unused direct packages remain removed', () => {
    const manifest = JSON.parse(read('package.json'));
    for (const dependency of ['20', 'crypto', 'grep', 'latest', 'router']) {
      expect(manifest.dependencies?.[dependency]).toBeUndefined();
      expect(manifest.devDependencies?.[dependency]).toBeUndefined();
    }
  });

  test('policy does not claim upstream advisories are fixed', () => {
    const policy = read('docs/V1_SECURITY_DEPENDENCY_RESIDUALS.md');
    expect(policy).toContain('not a claim that the upstream advisories are fixed');
    expect(policy).toContain('ACCEPTED WITH MITIGATIONS FOR V1');
  });
});
