#!/usr/bin/env node
'use strict';
// Read-only report of active customers sharing a normalised (digits-only) phone.
// Usage: TENANT_DATABASE_URL=postgres://... node scripts/report-duplicate-customer-phones.cjs [--format=json|csv]
// Optional: TENANT_SEARCH_PATH=<schema> to report on a non-public schema.
// Exit codes: 0 no duplicates, 1 duplicates found, 2 usage/connection error.
const { Client } = require('pg');

const DUPLICATES_SQL = `
  SELECT regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g') AS digits,
         id, name, current_balance, created_at
  FROM customers
  WHERE is_active = TRUE
    AND regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g') <> ''
    AND regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g') IN (
      SELECT regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g')
      FROM customers
      WHERE is_active = TRUE
        AND regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g') <> ''
      GROUP BY 1
      HAVING COUNT(*) > 1
    )
  ORDER BY digits, created_at, id`;

const groupRows = (rows) => {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.digits)) groups.set(r.digits, []);
    groups.get(r.digits).push({
      id: r.id,
      name: r.name,
      current_balance: r.current_balance === null ? null : Number(r.current_balance),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    });
  }
  return [...groups.entries()].map(([digits, customers]) => ({
    digits,
    customer_ids: customers.map((c) => c.id),
    customers,
  }));
};

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toCsv = (groups) => {
  const lines = ['digits,customer_id,name,current_balance,created_at'];
  for (const g of groups) {
    for (const c of g.customers) {
      lines.push([g.digits, c.id, c.name, c.current_balance, c.created_at].map(csvCell).join(','));
    }
  }
  return lines.join('\n');
};

const findDuplicateGroups = async (client) => groupRows((await client.query(DUPLICATES_SQL)).rows);

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const fmtArg = argv.find((a) => a.startsWith('--format='));
  const format = fmtArg ? fmtArg.split('=')[1] : 'json';
  const url = env.TENANT_DATABASE_URL || env.DATABASE_URL;
  if (!url || !['json', 'csv'].includes(format)) {
    process.stderr.write('Usage: TENANT_DATABASE_URL=<url> node scripts/report-duplicate-customer-phones.cjs [--format=json|csv]\n');
    return 2;
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    if (env.TENANT_SEARCH_PATH) await client.query('SELECT set_config($1, $2, false)', ['search_path', env.TENANT_SEARCH_PATH]);
    await client.query('SET default_transaction_read_only = on');
    const groups = await findDuplicateGroups(client);
    process.stdout.write(
      (format === 'csv' ? toCsv(groups) : JSON.stringify({ duplicate_groups: groups.length, groups }, null, 2)) + '\n'
    );
    return groups.length > 0 ? 1 : 0;
  } catch (err) {
    process.stderr.write(`report failed: ${err.message}\n`);
    return 2;
  } finally {
    await client.end().catch(() => {});
  }
};

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = { main, findDuplicateGroups, groupRows, toCsv, DUPLICATES_SQL };
