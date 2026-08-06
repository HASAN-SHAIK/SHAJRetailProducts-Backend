const toCustomerDto = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || row.mobile || null,
    mobile: row.mobile || row.phone || null,
    email: row.email || null,
    type: row.type,
    shop_name: row.shop_name,
    gst_number: row.gst_number,
    credit_limit: row.credit_limit,
    current_balance: row.current_balance,
    notes: row.notes,
    address: row.address,
    location: row.location,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

const toCustomerDetailDto = (payload) => {
  if (!payload) return null;
  return {
    customer: toCustomerDto(payload.customer),
    orders: payload.orders || [],
    payments: payload.payments || [],
  };
};

module.exports = { toCustomerDto, toCustomerDetailDto };
