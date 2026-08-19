const fs = require('fs');
const path = require('path');

const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');

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
