const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const toInventoryDto = (fact, branchId) => {
  if (!fact || !branchId) return null;

  const projectedNetQuantity = toNumber(fact.projected_net_quantity);
  return {
    branch_id: branchId,
    basis: 'branch_sellable_with_expiry_and_provisional_deficit',
    physical_quantity: toNumber(fact.physical_quantity),
    sellable_quantity: toNumber(fact.sellable_quantity),
    expired_quantity: toNumber(fact.expired_quantity),
    provisional_deficit: toNumber(fact.provisional_deficit),
    projected_net_quantity: projectedNetQuantity,
    is_low_stock: projectedNetQuantity > 0 && projectedNetQuantity < 10,
    is_out_of_stock: projectedNetQuantity <= 0,
  };
};

const toProductDto = (row, inventoryFact = null, inventoryBranchId = null) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    company: row.company,
    selling_price: row.selling_price,
    mrp: row.mrp,
    purchase_price: row.purchase_price,
    hsn_code: row.hsn_code,
    gst_percentage: row.gst_percentage,
    is_weight_based: row.is_weight_based,
    is_batch_enabled: row.is_batch_enabled,
    stock_quantity: row.stock_quantity,
    barcode: row.barcode,
    branch_id: row.branch_id,
    expiry_date: row.expiry_date,
    inventory: toInventoryDto(inventoryFact, inventoryBranchId),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

module.exports = { toProductDto, toInventoryDto };
