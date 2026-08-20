const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runbook = fs.readFileSync(path.join(root, 'docs/V1_DEPLOYMENT_SECRET_ROTATION.md'), 'utf8');
const posSync = fs.readFileSync(path.join(root, 'docs/POS_SYNC.md'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

function expectText(text, needle) {
  expect(text).toContain(needle);
}

describe('V1 deployment secret rotation contract', () => {
  test('keeps POS sync rotation durable and fail closed', () => {
    expectText(runbook, 'POS_SYNC_TOKEN');
    expectText(runbook, 'Durable outbox events must remain pending/retrying');
    expectText(runbook, 'do not clear the outbox or cursor');
    expectText(runbook, 'Verify the previous sync token is rejected');
    expectText(posSync, 'rotate through deployment tooling');
  });

  test('requires health/readiness and preserves durable state', () => {
    expectText(runbook, '/health');
    expectText(runbook, '/ready');
    expectText(runbook, 'Do not replace the SQLite database');
    expectText(runbook, 'Do not modify tenant/user data');
  });

  test('keeps secrets out of the Backend image definition', () => {
    expect(dockerfile).not.toMatch(/^\s*(?:ARG|ENV)\s+[^\n]*(?:JWT_SECRET|ADMIN_JWT_SECRET|POS_SYNC_TOKEN|PASSWORD)\s*=/mi);
    expectText(runbook, 'Never commit a real secret');
    expectText(runbook, 'process command line');
    expectText(runbook, 'never the value');
  });
});
