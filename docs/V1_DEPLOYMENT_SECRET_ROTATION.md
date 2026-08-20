# V1 Deployment Secret Rotation Contract

This runbook defines how production deployment credentials are replaced without moving secret values into source control, browser bundles, command-line arguments, logs, or diagnostics.

## General rules

- Store production secrets only in the deployment/provider secret store or the POS protected environment file managed by the installer.
- Never commit a real secret, copy one into a React `REACT_APP_*` variable, place it in a process command line, or print it in diagnostics.
- Treat a secret change as a deployment operation: change the authority, restart/reload the affected runtime, verify `/health` and `/ready`, then verify domain diagnostics.
- Preserve tenant databases, POS SQLite, local device identity, local API token and backups during secret replacement.
- If a replacement fails, roll back the credential/configuration only. Do not roll back or delete durable business state.

## POS Central sync credential replacement

V1 uses the deployment-scoped `POS_SYNC_TOKEN` contract documented in `docs/POS_SYNC.md`.

1. Confirm Central `/health` and `/ready` are healthy and record current POS outbox/change-feed diagnostics.
2. Create the replacement secret in the deployment secret store. Do not write it into the repository or Frontend configuration.
3. Update the Central POS sync authority to the replacement token and restart/reload Central.
4. During the short credential mismatch window, POS synchronization is expected to fail closed. Durable outbox events must remain pending/retrying; do not clear the outbox or cursor.
5. Replace `POS_SYNC_TOKEN` in the protected POS deployment environment and restart the POS service. Do not replace the SQLite database, device identity, local API token or backup directory.
6. Verify POS readiness, effective-configuration refresh, change-feed progress and outbox drain. Verify a new sale can converge exactly once.
7. Verify the previous sync token is rejected by Central before considering rotation complete.

If the new credential cannot be activated, restore the previous Central token and POS environment value. Durable POS outbox/inbox state remains the recovery source; business transactions are not recreated manually.

## Tenant and platform JWT signing-secret replacement

Tenant and platform-admin signing keys are separate Security V1 authorities. V1 does not promise transparent dual-key JWT rotation.

1. Schedule a controlled authentication maintenance window.
2. Replace the intended signing secret in the deployment secret store; never rotate tenant and platform-admin keys by copying one value into the other.
3. Restart Central and verify `/health` and `/ready`.
4. Existing tokens signed by the previous key may become invalid. Require affected users to authenticate again rather than accepting the previous key indefinitely.
5. Verify tenant tokens cannot authenticate platform-admin routes and platform-admin tokens cannot authenticate tenant routes.

Rollback means restoring only the immediately previous signing-secret value and restarting Central. Do not modify tenant/user data to recover from a signing-key deployment error.

## PostgreSQL and external-service credentials

Prefer provider-supported staged credentials: provision a replacement credential, update Central secret configuration, restart and verify `/ready`, then revoke the previous credential. If the provider only supports an in-place password change, use a maintenance window so Central is not intentionally left serving with invalid database credentials.

TLS verification, CA configuration, RabbitMQ credentials when enabled, support intake credentials, warmup keys and other Security V1 production configuration remain fail-closed. Never weaken certificate verification or validation merely to make a rotation succeed.

## Verification and rollback evidence

For every production rotation record only non-secret evidence:

- deployment/release identifier and exact source commit;
- secret category rotated, never the value;
- affected tenant/store/device scope;
- `/health` and `/ready` result;
- POS pending/dead-letter counts and change-feed/config refresh result when applicable;
- completion or rollback decision.

A rotation is complete only after the new credential works, the previous credential is rejected where applicable, and durable POS synchronization is converged.
