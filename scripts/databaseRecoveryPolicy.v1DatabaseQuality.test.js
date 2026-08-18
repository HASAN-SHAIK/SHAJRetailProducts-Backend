const fs = require('fs');
const path = require('path');

describe('V1 database recovery operator policy', () => {
  const repoRoot = path.join(__dirname, '..');
  const runbook = fs.readFileSync(
    path.join(repoRoot, 'docs', 'V1_DATABASE_RECOVERY_RUNBOOK.md'),
    'utf8'
  );
  const migrationRunner = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'runTenantMigration.js'),
    'utf8'
  );
  const recoveryTool = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'tenantDatabaseRecovery.js'),
    'utf8'
  );

  test('defaults recoverable migration defects to immutable forward-fix', () => {
    expect(runbook).toContain('**Forward-fix is the default**');
    expect(runbook).toContain('Do not edit or reuse an already-applied migration filename');
    expect(runbook).toContain('TENANT_MIGRATION_CHECKSUM_MISMATCH');
    expect(runbook).toContain('TENANT_MIGRATION_PARTIAL_FAILURE');
    expect(migrationRunner).toContain("error.code = 'TENANT_MIGRATION_PARTIAL_FAILURE'");
    expect(migrationRunner).toContain("error.code = 'TENANT_MIGRATION_CHECKSUM_MISMATCH'");
  });

  test('permits restore only through verified same-tenant native recovery', () => {
    expect(runbook).toContain('**Verified same-tenant native restore is the exception**');
    expect(runbook).toContain('TENANT_BACKUP_CHECKSUM_MISMATCH');
    expect(runbook).toContain('TENANT_RESTORE_TARGET_MISMATCH');
    expect(runbook).toContain('TENANT_RESTORE_CONFIRMATION_REQUIRED');
    expect(runbook).toContain('pg_restore --single-transaction --exit-on-error');
    expect(recoveryTool).toContain("'TENANT_BACKUP_CHECKSUM_MISMATCH'");
    expect(recoveryTool).toContain("'TENANT_RESTORE_TARGET_MISMATCH'");
    expect(recoveryTool).toContain("'TENANT_RESTORE_CONFIRMATION_REQUIRED'");
    expect(recoveryTool).toContain("'--single-transaction'");
    expect(recoveryTool).toContain("'--exit-on-error'");
  });

  test('keeps support JSON export and secrets outside canonical restore diagnostics', () => {
    expect(runbook).toContain('Do not treat the admin JSON support export as PostgreSQL restore authority.');
    expect(runbook).toContain('Passwords and complete connection strings are never part of the recovery report.');
    expect(runbook).toContain('migration filename and checksum');
    expect(runbook).toContain('applied/skipped/failed tenant database names');
    expect(runbook).toContain('backup tenant database identity and SHA-256');
  });
});
