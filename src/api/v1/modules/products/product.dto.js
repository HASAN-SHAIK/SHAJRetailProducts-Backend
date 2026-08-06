const toProductDto = (row) => {
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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

module.exports = { toProductDto };
