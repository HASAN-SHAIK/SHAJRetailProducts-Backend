# Store POS sync contract

The store-local service talks to the central enterprise server over HTTPS. It does not connect to RabbitMQ directly.

## Authentication

Configure the backend with `POS_SYNC_TOKEN` and `POS_SYNC_TENANT_ID`, or `POS_SYNC_TOKENS_JSON` for tenant-token maps. Each store installation is provisioned with:

- `POS_CENTRAL_API_URL`
- `POS_SYNC_TENANT_ID`
- `POS_SYNC_TOKEN` (the shared secret for the current deployment; rotate through deployment tooling)

Every POS sync request sends `X-POS-Tenant-ID`, `X-POS-Device-ID`, and `X-POS-Sync-Token`. The backend resolves the tenant database only after constant-time token validation. These endpoints are mounted before tenant-user JWT middleware because a headless store service has no interactive user session.

## Outbound store events

`POST /api/v1/sync/events` accepts the canonical local event envelope. V1 supports `sale.completed`. The event ID is also the idempotency key. The gateway converts the immutable POS sale snapshot to the existing sales sync operation and invokes the existing inline sync processor. A success response is returned only after the tenant PostgreSQL transaction has applied or recognized the sale as a duplicate.

The local outbox therefore remains pending/retrying until central application succeeds.

## Central change feed

`GET /api/v1/sync/changes?cursor=...&limit=...` returns an opaque cursor and replay-safe messages. V1 emits product, barcode, price, and customer projection changes. Message IDs contain source identity and source update time, allowing the store inbox to ignore replays.

The cursor is opaque to the POS. It advances only after the local store applies all returned messages.

## Security notes

The shared deployment secret is an initial provisioning mechanism. Production hardening should evolve it to per-device rotated credentials stored in the central device registry without changing the HTTP contract. Never place this credential in the React bundle.
