const pool = require('../db');

const getRequestPool = (req) => req.tenantPool || pool;

const toNumber = (value) => Number(value || 0);

const getBranchInventoryReport = async (req, res) => {
  const branchId = req.reportBranchId;
  if (!branchId) {
    return res.status(400).json({
      code: 'REPORT_BRANCH_SCOPE_REQUIRED',
      message: 'A trusted Central branch is required for branch inventory reporting.',
    });
  }

  try {
    const result = await getRequestPool(req).query(
      `WITH batch_physical AS (
         SELECT b.product_id,
                COALESCE(SUM(COALESCE(b.quantity_remaining, b.quantity)), 0)::numeric AS physical_quantity
         FROM batches b
         WHERE b.branch_id = $1::uuid
           AND b.is_deleted = FALSE
           AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
         GROUP BY b.product_id
       ),
       provisional_deficit AS (
         SELECT a.product_id,
                (SUM(CASE
                   WHEN a.source_movement_type = 'sale_issue' THEN a.quantity_milli
                   WHEN a.source_movement_type = 'sale_return' THEN -a.quantity_milli
                   ELSE 0
                 END)::numeric / 1000.0) AS deficit_quantity
         FROM pos_inventory_batch_allocations a
         WHERE a.branch_id = $1::uuid
           AND a.allocation_kind = 'unallocated'
         GROUP BY a.product_id
         HAVING SUM(CASE
           WHEN a.source_movement_type = 'sale_issue' THEN a.quantity_milli
           WHEN a.source_movement_type = 'sale_return' THEN -a.quantity_milli
           ELSE 0
         END) > 0
       ),
       scoped_products AS (
         SELECT p.id,
                p.selling_price,
                p.purchase_price,
                p.is_batch_enabled,
                CASE
                  WHEN p.is_batch_enabled = TRUE THEN COALESCE(bp.physical_quantity, 0)
                  ELSE COALESCE(p.stock_quantity, 0)
                END::numeric AS physical_quantity,
                CASE
                  WHEN p.is_batch_enabled = TRUE THEN COALESCE(pd.deficit_quantity, 0)
                  ELSE 0
                END::numeric AS provisional_deficit
         FROM products p
         LEFT JOIN batch_physical bp ON bp.product_id = p.id
         LEFT JOIN provisional_deficit pd ON pd.product_id = p.id
         WHERE p.is_deleted = FALSE
           AND (
             (p.is_batch_enabled = FALSE AND p.branch_id = $1::uuid)
             OR
             (p.is_batch_enabled = TRUE AND (
               p.branch_id = $1::uuid
               OR bp.product_id IS NOT NULL
               OR pd.product_id IS NOT NULL
             ))
           )
       ),
       facts AS (
         SELECT *,
                (physical_quantity - provisional_deficit)::numeric AS projected_net_quantity
         FROM scoped_products
       )
       SELECT
         COALESCE(SUM(physical_quantity), 0)::numeric AS physical_stock,
         COALESCE(SUM(provisional_deficit), 0)::numeric AS provisional_deficit,
         COALESCE(SUM(projected_net_quantity), 0)::numeric AS projected_net_stock,
         COUNT(*) FILTER (WHERE projected_net_quantity > 0 AND projected_net_quantity < 10)::int AS low_stock_products,
         COUNT(*) FILTER (WHERE projected_net_quantity <= 0)::int AS out_of_stock_products,
         COALESCE(SUM(GREATEST(physical_quantity, 0) * COALESCE(selling_price, 0)), 0)::numeric AS stock_value_selling,
         COALESCE(SUM(GREATEST(physical_quantity, 0) * COALESCE(purchase_price, 0)), 0)::numeric AS stock_value_purchase
       FROM facts`,
      [branchId]
    );

    const row = result.rows[0] || {};
    return res.json({
      branch_id: branchId,
      stock_basis: 'branch_physical_with_provisional_deficit',
      total_stock: toNumber(row.projected_net_stock),
      physical_stock: toNumber(row.physical_stock),
      provisional_deficit: toNumber(row.provisional_deficit),
      low_stock_products: Number(row.low_stock_products || 0),
      out_of_stock_products: Number(row.out_of_stock_products || 0),
      stock_value_selling: toNumber(row.stock_value_selling),
      stock_value_purchase: toNumber(row.stock_value_purchase),
    });
  } catch (error) {
    console.error('Branch inventory report error:', error);
    return res.status(500).json({
      code: 'REPORT_INVENTORY_FAILED',
      message: 'Unable to load branch inventory report.',
    });
  }
};

module.exports = { getBranchInventoryReport };
