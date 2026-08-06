# SHAJRetailProducts POS Service

Isolated local-service foundation for the SHAJRetail POS. This package intentionally makes **no UI changes** and is not yet connected to the existing React application.

## Foundation included

- Loopback-only Express API (`127.0.0.1:4782`)
- SQLite in WAL mode with foreign keys and full synchronous durability
- Ordered SQL migration runner
- Transactional outbox foundation
- Inbox deduplication foundation
- Sync checkpoints
- Health endpoint

## Run

```bash
cp .env.example .env
npm install
npm run migrate
npm start
curl http://127.0.0.1:4782/api/v1/health
```

## Migration sequence

1. Keep current React/Dexie behavior unchanged.
2. Add order-domain SQLite tables after mapping the current payload exactly.
3. Implement local order transaction + outbox atomically.
4. Add a repository adapter behind the existing frontend contracts.
5. Enable per-module with a feature flag and Dexie fallback.
6. Remove Dexie only after parity, offline, recovery, and rollback tests pass.

## Security boundary

The service binds to loopback by default. Before UI integration, add device provisioning, request authentication, strict origin checks, encrypted secrets, and signed update distribution.
