const crypto = require('crypto');

const normalizeDigits = (value) => String(value || '').replace(/\D+/g, '');

const tableExists = async (client, tableName) => {
  const res = await client.query(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists`,
    [tableName]
  );
  return res.rows[0]?.exists === true;
};

const listStockAuditLogs = async (pool, options = {}) => {
  const limit = Number.isFinite(Number(options.limit)) ? Math.min(Number(options.limit), 500) : 100;
  const productId = Number(options.product_id);
  const values = [];
  const where = [];
  if (Number.isFinite(productId)) {
    values.push(productId);
    where.push(`l.product_id = $${values.length}`);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT l.id,
            l.product_id,
            p.name AS product_name,
            l.batch_id,
            l.branch_id,
            l.actor_user_id,
            l.actor_role,
            l.actor_name,
            l.reason,
            l.source_type,
            l.reference_id,
            l.delta_quantity,
            l.before_quantity,
            l.after_quantity,
            l.delta_purchase_price,
            l.before_purchase_price,
            l.after_purchase_price,
            l.delta_selling_price,
            l.before_selling_price,
            l.after_selling_price,
            l.note,
            l.metadata,
            l.created_at
     FROM stock_audit_logs l
     LEFT JOIN products p ON p.id = l.product_id
     ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT $${values.length + 1}`,
    [...values, limit]
  );
  return result.rows;
};

const getCustomerDuplicateSuggestions = async (pool, limit = 50) => {
  const result = await pool.query(
    `WITH normalized AS (
        SELECT id, name, COALESCE(phone, mobile) AS phone
        FROM customers
        WHERE COALESCE(is_merged, FALSE) = FALSE
      ),
      dup_phone AS (
        SELECT regexp_replace(COALESCE(phone, ''), '[^0-9]+', '', 'g') AS key
        FROM normalized
        WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]+', '', 'g') <> ''
        GROUP BY regexp_replace(COALESCE(phone, ''), '[^0-9]+', '', 'g')
        HAVING COUNT(*) > 1
      )
      SELECT 'phone'::text AS reason,
             n.id,
             n.name,
             n.phone,
             regexp_replace(COALESCE(n.phone, ''), '[^0-9]+', '', 'g') AS match_key
      FROM normalized n
      JOIN dup_phone d ON d.key = regexp_replace(COALESCE(n.phone, ''), '[^0-9]+', '', 'g')
      ORDER BY match_key ASC, id ASC
      LIMIT $1`,
    [limit]
  );
  return result.rows;
};

const getProductDuplicateSuggestions = async (pool, limit = 50) => {
  const barcodeRes = await pool.query(
    `WITH normalized AS (
        SELECT id, name, company, barcode
        FROM products
        WHERE is_deleted = FALSE
      ),
      dup_barcode AS (
        SELECT LOWER(TRIM(barcode)) AS key
        FROM normalized
        WHERE barcode IS NOT NULL
          AND TRIM(barcode) <> ''
        GROUP BY LOWER(TRIM(barcode))
        HAVING COUNT(*) > 1
      )
      SELECT 'barcode'::text AS reason,
             n.id,
             n.name,
             n.company,
             n.barcode,
             LOWER(TRIM(n.barcode)) AS match_key
      FROM normalized n
      JOIN dup_barcode d ON d.key = LOWER(TRIM(n.barcode))
      ORDER BY match_key ASC, id ASC
      LIMIT $1`,
    [limit]
  );

  const nameRes = await pool.query(
    `WITH normalized AS (
        SELECT id, name, company, barcode
        FROM products
        WHERE is_deleted = FALSE
      ),
      dup_name AS (
        SELECT LOWER(TRIM(name)) AS key
        FROM normalized
        WHERE name IS NOT NULL
          AND TRIM(name) <> ''
        GROUP BY LOWER(TRIM(name))
        HAVING COUNT(*) > 1
      )
      SELECT 'name'::text AS reason,
             n.id,
             n.name,
             n.company,
             n.barcode,
             LOWER(TRIM(n.name)) AS match_key
      FROM normalized n
      JOIN dup_name d ON d.key = LOWER(TRIM(n.name))
      ORDER BY match_key ASC, id ASC
      LIMIT $1`,
    [limit]
  );

  return [...barcodeRes.rows, ...nameRes.rows];
};

const mergeCustomers = async (pool, payload = {}, actor = {}) => {
  const primaryId = Number(payload.primary_id || payload.primaryId);
  const secondaryId = Number(payload.secondary_id || payload.secondaryId);
  if (!Number.isFinite(primaryId) || !Number.isFinite(secondaryId) || primaryId === secondaryId) {
    const error = new Error('primary_id and secondary_id are required and must be different');
    error.status = 400;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customersRes = await client.query(
      `SELECT * FROM customers WHERE id = ANY($1) FOR UPDATE`,
      [[primaryId, secondaryId]]
    );
    if (customersRes.rowCount !== 2) {
      const error = new Error('Both customers must exist');
      error.status = 404;
      throw error;
    }
    const primary = customersRes.rows.find((row) => Number(row.id) === primaryId);
    const secondary = customersRes.rows.find((row) => Number(row.id) === secondaryId);

    await client.query(
      `UPDATE orders
       SET customer_id = $1
       WHERE customer_id = $2`,
      [primaryId, secondaryId]
    );

    if (await tableExists(client, 'customer_payments')) {
      await client.query(
        `UPDATE customer_payments
         SET customer_id = $1
         WHERE customer_id = $2`,
        [primaryId, secondaryId]
      );
    }

    const mergedBalance = Number(primary.current_balance || 0) + Number(secondary.current_balance || 0);
    const mergedLimit = Math.max(Number(primary.credit_limit || 0), Number(secondary.credit_limit || 0));
    await client.query(
      `UPDATE customers
       SET current_balance = $1,
           credit_limit = $2,
           notes = CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END, $3),
           updated_at = NOW()
       WHERE id = $4`,
      [
        mergedBalance,
        mergedLimit,
        `Merged customer #${secondaryId}`,
        primaryId
      ]
    );

    await client.query(
      `UPDATE customers
       SET is_merged = TRUE,
           merged_into_id = $1,
           is_active = FALSE,
           updated_at = NOW()
       WHERE id = $2`,
      [primaryId, secondaryId]
    );

    await client.query(
      `INSERT INTO dedupe_merge_logs (
          entity_type,
          primary_id,
          secondary_id,
          merged_by_user_id,
          merged_by_role,
          merge_reason,
          metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        'customer',
        primaryId,
        secondaryId,
        actor.user_id || null,
        actor.role || null,
        payload.reason || null,
        JSON.stringify({ primary_name: primary.name, secondary_name: secondary.name })
      ]
    );

    await client.query('COMMIT');
    return { primary_id: primaryId, secondary_id: secondaryId, merged: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const mergeProducts = async (pool, payload = {}, actor = {}) => {
  const primaryId = Number(payload.primary_id || payload.primaryId);
  const secondaryId = Number(payload.secondary_id || payload.secondaryId);
  if (!Number.isFinite(primaryId) || !Number.isFinite(secondaryId) || primaryId === secondaryId) {
    const error = new Error('primary_id and secondary_id are required and must be different');
    error.status = 400;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const productsRes = await client.query(
      `SELECT * FROM products WHERE id = ANY($1) FOR UPDATE`,
      [[primaryId, secondaryId]]
    );
    if (productsRes.rowCount !== 2) {
      const error = new Error('Both products must exist');
      error.status = 404;
      throw error;
    }
    const primary = productsRes.rows.find((row) => Number(row.id) === primaryId);
    const secondary = productsRes.rows.find((row) => Number(row.id) === secondaryId);

    await client.query(
      `UPDATE order_items
       SET product_id = $1
       WHERE product_id = $2`,
      [primaryId, secondaryId]
    );
    await client.query(
      `UPDATE batches
       SET product_id = $1
       WHERE product_id = $2`,
      [primaryId, secondaryId]
    );

    const stockMerged = Number(primary.stock_quantity || 0) + Number(secondary.stock_quantity || 0);
    await client.query(
      `UPDATE products
       SET stock_quantity = $1,
           purchase_price = COALESCE(purchase_price, $2),
           selling_price = COALESCE(selling_price, $3),
           mrp = COALESCE(mrp, $4),
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $5`,
      [stockMerged, secondary.purchase_price, secondary.selling_price, secondary.mrp, primaryId]
    );
    await client.query(
      `UPDATE products
       SET is_deleted = TRUE,
           merged_into_id = $1,
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $2`,
      [primaryId, secondaryId]
    );

    await client.query(
      `INSERT INTO dedupe_merge_logs (
          entity_type,
          primary_id,
          secondary_id,
          merged_by_user_id,
          merged_by_role,
          merge_reason,
          metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        'product',
        primaryId,
        secondaryId,
        actor.user_id || null,
        actor.role || null,
        payload.reason || null,
        JSON.stringify({ primary_name: primary.name, secondary_name: secondary.name })
      ]
    );

    await client.query('COMMIT');
    return { primary_id: primaryId, secondary_id: secondaryId, merged: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const exportFullBackup = async (pool) => {
  const tables = ['products', 'batches', 'customers', 'orders', 'order_items', 'transactions', 'suppliers', 'expenses'];
  const exportData = {};
  for (const table of tables) {
    if (!(await tableExists(pool, table))) {
      exportData[table] = [];
      continue;
    }
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY 1 ASC`);
    exportData[table] = result.rows;
  }
  const payload = {
    exported_at: new Date().toISOString(),
    tables: exportData
  };
  const checksum = crypto.createHash('sha256').update(JSON.stringify(payload.tables)).digest('hex');
  return {
    ...payload,
    checksum,
    counts: Object.fromEntries(
      Object.entries(exportData).map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : 0])
    )
  };
};

const verifyBackupPayload = (backupPayload = {}) => {
  const tables = backupPayload?.tables && typeof backupPayload.tables === 'object' ? backupPayload.tables : {};
  const checksum = crypto.createHash('sha256').update(JSON.stringify(tables)).digest('hex');
  const provided = backupPayload?.checksum || null;
  const valid = Boolean(provided) && String(provided) === String(checksum);
  return {
    valid,
    provided_checksum: provided,
    computed_checksum: checksum,
    counts: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : 0])
    )
  };
};

module.exports = {
  normalizeDigits,
  listStockAuditLogs,
  getCustomerDuplicateSuggestions,
  getProductDuplicateSuggestions,
  mergeCustomers,
  mergeProducts,
  exportFullBackup,
  verifyBackupPayload
};
