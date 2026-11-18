#!/usr/bin/env node
/*
 * Backfill the tenant login directory.
 *
 * Mobile and POS sign-in with just an email looks the company up in
 * `tenant_login_directory` (master DB). A user created while that sync was
 * skipped can log in nowhere ("Tenant not found"). This script finds every
 * user in every active tenant database that has no directory row and,
 * with --apply, adds it.
 *
 *   node scripts/backfill-login-directory.cjs            # dry run: report only, nothing written
 *   node scripts/backfill-login-directory.cjs --apply    # write the missing rows
 *   node scripts/backfill-login-directory.cjs --show-emails   # print full emails (default: masked)
 *
 * It uses the same environment as the Backend (MASTER_DATABASE_URL, TENANT_DATABASE_URL_TEMPLATE, ...),
 * so run it with the env of the environment you want to repair. It never prints
 * connection strings or passwords, and it only ever INSERTs/UPDATEs directory rows.
 */

const maskEmail = (email) => {
  const [local = '', domain = ''] = String(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

/**
 * Pure core so it can be tested with fake pools.
 * @returns {Promise<{tenants:number, users:number, missing:number, added:number, details:Array}>}
 */
const backfillLoginDirectory = async ({
  masterPool,
  getTenantPool,
  registerTenantLoginEntry,
  apply = false,
  log = () => {},
}) => {
  const tenants = await masterPool.query(
    `SELECT id, domain, database_name, shop_name
       FROM tenants
      WHERE COALESCE(is_active, TRUE) = TRUE AND domain IS NOT NULL AND domain <> ''
      ORDER BY id`
  );

  const existing = await masterPool.query(
    `SELECT tenant_id, LOWER(email) AS email FROM tenant_login_directory`
  );
  const known = new Set(existing.rows.map((r) => `${r.tenant_id}|${r.email}`));

  const summary = { tenants: 0, users: 0, missing: 0, added: 0, errors: 0, details: [] };

  for (const tenant of tenants.rows) {
    summary.tenants += 1;
    let users;
    try {
      const pool = getTenantPool(tenant.database_name);
      users = await pool.query(`SELECT email FROM users WHERE email IS NOT NULL AND email <> ''`);
    } catch (error) {
      summary.errors += 1;
      log(`tenant ${tenant.id} (${tenant.domain}): could not read users: ${error.message}`);
      continue;
    }
    for (const row of users.rows) {
      const email = String(row.email).trim().toLowerCase();
      if (!email) continue;
      summary.users += 1;
      if (known.has(`${tenant.id}|${email}`)) continue;
      summary.missing += 1;
      const detail = { tenant_id: tenant.id, company_code: tenant.domain, email };
      if (apply) {
        try {
          const written = await registerTenantLoginEntry({
            tenantId: tenant.id,
            email,
            companyCode: tenant.domain,
          });
          if (written) {
            summary.added += 1;
            detail.added = true;
          }
        } catch (error) {
          summary.errors += 1;
          detail.error = error.message;
        }
      }
      summary.details.push(detail);
    }
  }
  return summary;
};

module.exports = { backfillLoginDirectory, maskEmail };

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const showEmails = args.has('--show-emails');
  (async () => {
    require('dotenv').config();
    const masterPool = require('../src/db/masterPool');
    const { getTenantPool } = require('../src/db/tenantPool');
    const {
      ensureTenantLoginDirectorySchema,
      registerTenantLoginEntry,
    } = require('../src/services/tenantLoginDirectoryService');

    await ensureTenantLoginDirectorySchema();
    const summary = await backfillLoginDirectory({
      masterPool,
      getTenantPool,
      registerTenantLoginEntry,
      apply,
      log: (m) => console.warn(m),
    });
    console.log(apply ? 'MODE: apply (rows written)' : 'MODE: dry run (nothing written; add --apply to write)');
    console.log(
      `tenants scanned: ${summary.tenants} | users: ${summary.users} | missing from directory: ${summary.missing}` +
        (apply ? ` | added: ${summary.added}` : '') +
        ` | errors: ${summary.errors}`
    );
    for (const d of summary.details) {
      const who = showEmails ? d.email : maskEmail(d.email);
      console.log(
        `  ${apply ? (d.added ? 'added  ' : 'FAILED ') : 'missing'} ${d.company_code}  ${who}${d.error ? '  (' + d.error + ')' : ''}`
      );
    }
    await masterPool.end?.();
    process.exit(summary.errors ? 1 : 0);
  })().catch((error) => {
    console.error('Backfill failed:', error.message);
    process.exit(1);
  });
}
