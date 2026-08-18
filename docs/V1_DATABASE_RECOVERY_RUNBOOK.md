# SHAJRetailProducts V1 Database Recovery Runbook

## Purpose

This runbook defines the V1 operator decision boundary for tenant PostgreSQL migration failures and native PostgreSQL recovery. Central remains the canonical tenant database authority. Recovery must preserve tenant isolation, migration history, and verified backup provenance.

## Default decision: forward-fix

Use a forward-fix migration when all of the following are true:

- the tenant database is reachable and PostgreSQL integrity is intact;
- the failure is schema/application compatibility rather than physical data loss or corruption;
- the failed migration transaction rolled back, or the exact committed state is understood from `tenant_schema_migrations`;
- the repair can be expressed as a new immutable migration instead of editing an already-applied migration file;
- existing canonical business facts should be preserved in place.

Do not edit or reuse an already-applied migration filename with different contents. `TENANT_MIGRATION_CHECKSUM_MISMATCH` is a stop condition that requires a new forward migration or an operator investigation.

For fleet execution, `TENANT_MIGRATION_PARTIAL_FAILURE` is a deployment failure even when some tenants applied successfully. Use the attached per-tenant failure summary to identify the affected tenant databases. Do not rerun by blindly changing migration history.

## Native restore decision

Use the native PostgreSQL restore path only when a forward-fix cannot safely preserve the canonical tenant state, for example:

- confirmed destructive or corrupt database state;
- operator-approved recovery to a previously verified tenant backup after an unsafe external change;
- disaster recovery where canonical facts cannot be reconstructed safely in place.

Before restore:

1. Stop tenant writes and preserve the current failed database state for investigation where operationally possible.
2. Verify the archive with `node scripts/tenantDatabaseRecovery.js verify --backup=<path>`.
3. Require a valid manifest and SHA-256 match; `TENANT_BACKUP_CHECKSUM_MISMATCH`, `TENANT_BACKUP_MANIFEST_INVALID`, or `TENANT_DATABASE_RECOVERY_TOOL_FAILED` are stop conditions.
4. Confirm the manifest tenant database exactly matches the intended target. `TENANT_RESTORE_TARGET_MISMATCH` is a hard stop.
5. Require explicit `--confirm-tenant=<database>` confirmation. `TENANT_RESTORE_CONFIRMATION_REQUIRED` is a hard stop.
6. Restore only through `tenantDatabaseRecovery.js restore`, which uses `pg_restore --single-transaction --exit-on-error` and post-restore core-table validation.
7. After restore, rerun the current ordered tenant migrations so the restored tenant converges to the current immutable migration history.
8. Re-run the affected V1 health/acceptance checks before allowing normal tenant writes.

## Prohibited recovery actions

- Do not restore a backup into a different tenant database.
- Do not bypass checksum or manifest verification.
- Do not manually mark a failed migration as applied.
- Do not edit an already-applied migration to make a rerun pass.
- Do not treat the admin JSON support export as PostgreSQL restore authority.
- Do not continue deployment after `TENANT_MIGRATION_PARTIAL_FAILURE` as if the fleet were consistent.
- Do not expose database passwords, sync tokens, JWTs, or connection strings in operator diagnostics.

## Actionable diagnostics

Migration failures must identify affected tenant database names and typed failure codes without secrets. Native backup/restore failures must surface their typed `TENANT_*` code and safe message. Operators should retain:

- migration filename and checksum;
- applied/skipped/failed tenant database names;
- rollback failure, if any;
- backup archive path and manifest path;
- backup tenant database identity and SHA-256;
- post-restore smoke result.

Passwords and complete connection strings are never part of the recovery report.

## V1 release policy

- **Forward-fix is the default** for recoverable schema/application migration defects.
- **Verified same-tenant native restore is the exception** for destructive/corrupt state that cannot be repaired safely in place.
- Both paths must converge back through immutable ordered migrations and produce a green database-quality acceptance result before release traffic resumes.
