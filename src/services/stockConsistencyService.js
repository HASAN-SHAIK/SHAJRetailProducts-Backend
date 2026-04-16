const pool = require('../db');
const masterPool = require('../db/masterPool');
const { getTenantPool } = require('../db/tenantPool');

const getRequestPool = (req) => req.tenantPool || pool;

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const runConsistencyCheckForPool = async (client, options = {}) => {
  const { autoHeal = true, source = 'manual', runBy = null } = options;
  const runRes = await client.query(
    `INSERT INTO stock_consistency_runs (status, auto_heal_enabled, source, triggered_by)
     VALUES ('running', $1, $2, $3)
     RETURNING id, started_at`,
    [autoHeal === true, source || 'manual', runBy || null]
  );
  const runId = runRes.rows[0].id;

  try {
    const mismatchRes = await client.query(
      `WITH batch_totals AS (
          SELECT b.product_id,
                 COALESCE(SUM(COALESCE(b.quantity_remaining, b.quantity)), 0)::numeric AS batch_total
          FROM batches b
          WHERE b.is_deleted = FALSE
          GROUP BY b.product_id
       )
       SELECT p.id AS product_id,
              p.name AS product_name,
              COALESCE(p.stock_quantity, 0)::numeric AS product_stock,
              COALESCE(bt.batch_total, 0)::numeric AS batch_total
       FROM products p
       LEFT JOIN batch_totals bt ON bt.product_id = p.id
       WHERE p.is_deleted = FALSE
         AND COALESCE(p.stock_quantity, 0)::numeric <> COALESCE(bt.batch_total, 0)::numeric
       ORDER BY p.id ASC`
    );

    const mismatches = [];
    for (const row of mismatchRes.rows) {
      const productStock = asNumber(row.product_stock);
      const batchTotal = asNumber(row.batch_total);
      const delta = batchTotal - productStock;
      let healed = false;

      if (autoHeal) {
        await client.query(
          `UPDATE products
           SET stock_quantity = $1,
               updated_at = (NOW() AT TIME ZONE 'UTC')
           WHERE id = $2`,
          [batchTotal, row.product_id]
        );
        healed = true;
      }

      await client.query(
        `INSERT INTO stock_consistency_run_items (
            run_id,
            product_id,
            product_name,
            product_stock_quantity,
            batches_total_quantity,
            delta_quantity,
            healed,
            heal_target_quantity
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [runId, row.product_id, row.product_name, productStock, batchTotal, delta, healed, healed ? batchTotal : null]
      );

      mismatches.push({
        product_id: row.product_id,
        product_name: row.product_name,
        product_stock_quantity: productStock,
        batches_total_quantity: batchTotal,
        delta_quantity: delta,
        healed
      });
    }

    await client.query(
      `UPDATE stock_consistency_runs
       SET status = 'completed',
           finished_at = NOW(),
           mismatch_count = $1,
           healed_count = $2
       WHERE id = $3`,
      [mismatches.length, mismatches.filter((item) => item.healed).length, runId]
    );

    return { run_id: runId, mismatch_count: mismatches.length, mismatches };
  } catch (error) {
    await client.query(
      `UPDATE stock_consistency_runs
       SET status = 'failed',
           finished_at = NOW(),
           error_message = $1
       WHERE id = $2`,
      [error.message || 'Consistency check failed', runId]
    );
    throw error;
  }
};

const runConsistencyCheckForRequest = async (req, options = {}) => {
  const requestPool = getRequestPool(req);
  const client = await requestPool.connect();
  try {
    return await runConsistencyCheckForPool(client, options);
  } finally {
    client.release();
  }
};

const getLatestConsistencyRun = async (req) => {
  const requestPool = getRequestPool(req);
  const runRes = await requestPool.query(
    `SELECT id, status, auto_heal_enabled, source, triggered_by, mismatch_count, healed_count, error_message, started_at, finished_at
     FROM stock_consistency_runs
     ORDER BY started_at DESC
     LIMIT 1`
  );
  if (runRes.rowCount === 0) return null;
  const run = runRes.rows[0];
  const itemsRes = await requestPool.query(
    `SELECT product_id, product_name, product_stock_quantity, batches_total_quantity, delta_quantity, healed, heal_target_quantity, created_at
     FROM stock_consistency_run_items
     WHERE run_id = $1
     ORDER BY ABS(delta_quantity) DESC, product_id ASC`,
    [run.id]
  );
  return { ...run, items: itemsRes.rows };
};

const runConsistencyForAllActiveTenants = async () => {
  const tenantsRes = await masterPool.query(
    `SELECT id, database_name
     FROM tenants
     WHERE is_active = TRUE
       AND database_name IS NOT NULL
     ORDER BY id ASC`
  );
  const summary = {
    total_tenants: tenantsRes.rowCount,
    completed_tenants: 0,
    failed_tenants: 0,
    mismatch_count: 0,
    healed_count: 0,
    failures: []
  };

  for (const tenant of tenantsRes.rows) {
    const tenantPool = getTenantPool(tenant.database_name);
    const client = await tenantPool.connect();
    try {
      const result = await runConsistencyCheckForPool(client, {
        autoHeal: true,
        source: 'scheduled',
        runBy: `system:${tenant.id}`
      });
      summary.completed_tenants += 1;
      summary.mismatch_count += Number(result.mismatch_count || 0);
      summary.healed_count += Number(result.mismatches?.filter((item) => item.healed).length || 0);
    } catch (error) {
      summary.failed_tenants += 1;
      summary.failures.push({
        tenant_id: tenant.id,
        database_name: tenant.database_name,
        error: error.message || 'Failed'
      });
    } finally {
      client.release();
    }
  }

  return summary;
};

module.exports = {
  runConsistencyCheckForPool,
  runConsistencyCheckForRequest,
  getLatestConsistencyRun,
  runConsistencyForAllActiveTenants
};
