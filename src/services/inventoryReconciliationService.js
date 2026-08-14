const normalizePositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const normalizeOptional = (value) => {
  const result = String(value ?? '').trim();
  return result || null;
};

const listInventoryReconciliation = async (tenantPool, filters = {}) => {
  if (!tenantPool || typeof tenantPool.query !== 'function') {
    throw new Error('tenant database is required');
  }

  const movementId = normalizeOptional(filters.movementId);
  const branchId = normalizeOptional(filters.branchId);
  const productId = normalizeOptional(filters.productId);
  const limit = normalizePositiveInt(filters.limit, 50, 200);

  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (movementId) add('m.movement_id = ?', movementId);
  if (branchId) add('m.canonical_branch_id = ?::uuid', branchId);
  if (productId) add('m.product_id = ?', productId);

  params.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await tenantPool.query(
    `SELECT
       m.movement_id,
       m.order_id,
       m.order_item_id,
       m.store_id,
       m.product_id,
       p.name AS product_name,
       m.movement_type,
       m.quantity_delta_milli,
       m.balance_after_milli AS pos_balance_after_milli,
       m.occurred_at,
       m.canonical_applied_at,
       m.canonical_device_id,
       m.canonical_branch_id,
       b.name AS canonical_branch_name,
       p.stock_quantity AS canonical_stock_quantity,
       CASE WHEN m.canonical_applied_at IS NULL THEN 'pending' ELSE 'applied' END AS canonical_status,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'allocation_seq', a.allocation_seq,
             'batch_id', a.batch_id,
             'quantity_milli', a.quantity_milli,
             'allocation_kind', a.allocation_kind,
             'source_movement_type', a.source_movement_type
           ) ORDER BY a.allocation_seq
         ) FILTER (WHERE a.movement_id IS NOT NULL),
         '[]'::jsonb
       ) AS batch_allocations
     FROM pos_inventory_movements m
     LEFT JOIN products p
       ON m.product_id ~ '^[0-9]+$'
      AND p.id = m.product_id::int
     LEFT JOIN branches b ON b.id = m.canonical_branch_id
     LEFT JOIN pos_inventory_batch_allocations a ON a.movement_id = m.movement_id
     ${whereSql}
     GROUP BY
       m.movement_id,m.order_id,m.order_item_id,m.store_id,m.product_id,p.name,
       m.movement_type,m.quantity_delta_milli,m.balance_after_milli,m.occurred_at,
       m.canonical_applied_at,m.canonical_device_id,m.canonical_branch_id,b.name,p.stock_quantity
     ORDER BY m.occurred_at DESC, m.movement_id DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows || [];
};

module.exports = { listInventoryReconciliation };
