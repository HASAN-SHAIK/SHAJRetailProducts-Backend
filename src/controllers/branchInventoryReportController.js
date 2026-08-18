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
      `WITH batch_truth AS (
         SELECT b.product_id,
                COALESCE(SUM(COALESCE(b.quantity_remaining, b.quantity)), 0)::numeric AS physical_quantity,
                COALESCE(SUM(CASE
                  WHEN b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE
                    THEN COALESCE(b.quantity_remaining, b.quantity)
                  ELSE 0
                END), 0)::numeric AS sellable_quantity,
                COALESCE(SUM(CASE
                  WHEN b.expiry_date < CURRENT_DATE
                    THEN COALESCE(b.quantity_remaining, b.quantity)
                  ELSE 0
                END), 0)::numeric AS expired_quantity
         FROM batches b
         WHERE b.branch_id = $1::uuid
           AND b.is_deleted = FALSE
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
                COALESCE(p.is_batch_enabled, FALSE) AS is_batch_enabled,
                CASE
                  WHEN COALESCE(p.is_batch_enabled, FALSE) = TRUE THEN COALESCE(bt.physical_quantity, 0)
                  ELSE COALESCE(p.stock_quantity, 0)
                END::numeric AS physical_quantity,
                CASE
                  WHEN COALESCE(p.is_batch_enabled, FALSE) = TRUE THEN COALESCE(bt.sellable_quantity, 0)
                  WHEN p.expiry_date IS NOT NULL AND p.expiry_date < CURRENT_DATE THEN 0
                  ELSE COALESCE(p.stock_quantity, 0)
                END::numeric AS sellable_quantity,
                CASE
                  WHEN COALESCE(p.is_batch_enabled, FALSE) = TRUE THEN COALESCE(bt.expired_quantity, 0)
                  WHEN p.expiry_date IS NOT NULL AND p.expiry_date < CURRENT_DATE THEN COALESCE(p.stock_quantity, 0)
                  ELSE 0
                END::numeric AS expired_quantity,
                CASE
                  WHEN COALESCE(p.is_batch_enabled, FALSE) = TRUE THEN COALESCE(pd.deficit_quantity, 0)
                  ELSE 0
                END::numeric AS provisional_deficit
         FROM products p
         LEFT JOIN batch_truth bt ON bt.product_id = p.id
         LEFT JOIN provisional_deficit pd ON pd.product_id = p.id
         WHERE p.is_deleted = FALSE
           AND (
             (COALESCE(p.is_batch_enabled, FALSE) = FALSE AND p.branch_id = $1::uuid)
             OR
             (COALESCE(p.is_batch_enabled, FALSE) = TRUE AND (
               p.branch_id = $1::uuid
               OR bt.product_id IS NOT NULL
               OR pd.product_id IS NOT NULL
             ))
           )
       ),
       facts AS (
         SELECT *,
                (sellable_quantity - provisional_deficit)::numeric AS projected_net_quantity
         FROM scoped_products
       )
       SELECT
         COALESCE(SUM(physical_quantity), 0)::numeric AS physical_stock,
         COALESCE(SUM(sellable_quantity), 0)::numeric AS sellable_stock,
         COALESCE(SUM(expired_quantity), 0)::numeric AS expired_stock,
         COALESCE(SUM(provisional_deficit), 0)::numeric AS provisional_deficit,
         COALESCE(SUM(projected_net_quantity), 0)::numeric AS projected_net_stock,
         COUNT(*) FILTER (WHERE projected_net_quantity > 0 AND projected_net_quantity < 10)::int AS low_stock_products,
         COUNT(*) FILTER (WHERE projected_net_quantity <= 0)::int AS out_of_stock_products,
         COALESCE(SUM(GREATEST(sellable_quantity, 0) * COALESCE(selling_price, 0)), 0)::numeric AS stock_value_selling,
         COALESCE(SUM(GREATEST(sellable_quantity, 0) * COALESCE(purchase_price, 0)), 0)::numeric AS stock_value_purchase
       FROM facts`,
      [branchId]
    );

    const row = result.rows[0] || {};
    return res.json({
      branch_id: branchId,
      stock_basis: 'branch_sellable_with_expiry_and_provisional_deficit',
      total_stock: toNumber(row.projected_net_stock),
      physical_stock: toNumber(row.physical_stock),
      sellable_stock: toNumber(row.sellable_stock),
      expired_stock: toNumber(row.expired_stock),
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
