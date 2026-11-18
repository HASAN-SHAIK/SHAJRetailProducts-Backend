require('dotenv').config({ path: '.env.test'});

// Tests talk to a local Postgres without TLS. src/db.js also loads the developer's
// regular .env (dotenv never overrides a variable that already exists), which may
// carry DB_SSL=true for a cloud database. Pin it for tests unless a test sets it.
if (process.env.DB_SSL === undefined) process.env.DB_SSL = 'false';
