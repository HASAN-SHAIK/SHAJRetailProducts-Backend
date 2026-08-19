const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcRoot = path.join(root, 'src');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walkJs(full);
  return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
});

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('V1 Backend container runtime security', () => {
  test('runs with production security policy enabled', () => {
    expect(dockerfile).toMatch(/^ENV NODE_ENV=production$/m);
  });

  test('drops root privileges before starting Central', () => {
    const userIndex = dockerfile.indexOf('USER node');
    const cmdIndex = dockerfile.indexOf('CMD ["node", "src/server.js"]');

    expect(userIndex).toBeGreaterThan(-1);
    expect(cmdIndex).toBeGreaterThan(userIndex);
  });

  test('gives the runtime user ownership of the application tree', () => {
    expect(dockerfile).toMatch(/^RUN chown -R node:node \/app$/m);
  });
});

describe('V1 production configuration residual audit', () => {
  test('source code does not provide literal fallback credentials for sensitive environment variables', () => {
    const findings = [];
    const literalFallback = /process\.env\.([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY)[A-Z0-9_]*)\s*(?:\|\||\?\?)\s*(['"`])([^'"`]+)\2/g;

    for (const file of walkJs(srcRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = literalFallback.exec(source)) !== null) {
        findings.push({
          file: path.relative(srcRoot, file),
          env: match[1],
          fallback: match[3],
        });
      }
    }

    expect(findings).toEqual([]);
  });

  test('database pools delegate TLS and production error hygiene to shared security policies', () => {
    for (const relativePath of ['src/db/masterPool.js', 'src/db/adminPool.js', 'src/db/tenantPool.js']) {
      const source = read(relativePath);
      expect(source).toContain('resolveDatabaseSslConfig');
      expect(source).toContain('logPoolError');
      expect(source).not.toContain('rejectUnauthorized: false');
      expect(source).not.toMatch(/console\.error\([^\n]*\berr\b/);
    }
  });

  test('known privileged production fallback credentials and destinations stay removed', () => {
    const masterBootstrap = read('src/services/masterBootstrap.js');
    const seedAdmin = read('scripts/seedAdmin.js');
    const supportNotification = read('src/services/supportNotification.service.js');

    expect(masterBootstrap).not.toContain('hasan@shaj.com');
    expect(masterBootstrap).toContain('ADMIN_SEED_');
    expect(seedAdmin).toContain('ADMIN_SEED_');
    expect(supportNotification).toContain('SUPPORT_CASE_INTAKE_EMAIL');
  });
});
