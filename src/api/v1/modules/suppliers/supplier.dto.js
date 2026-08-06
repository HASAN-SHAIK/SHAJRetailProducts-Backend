const toSupplierDto = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    email: row.email,
    address: row.address,
    gst_number: row.gst_number,
    credit_limit: row.credit_limit,
    current_balance: row.current_balance,
    branch_id: row.branch_id,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

module.exports = { toSupplierDto };
