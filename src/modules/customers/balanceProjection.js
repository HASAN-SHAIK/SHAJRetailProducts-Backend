const toPositiveIntegerId = (value) => {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
};

const computeCustomerOutstanding = async (client, customerId) => {
  const id = toPositiveIntegerId(customerId);
  if (!id) return null;

  const result = await client.query(
    `SELECT
       GREATEST(
         COALESCE((
           SELECT SUM(
             GREATEST(
               COALESCE(o.total_price,0)
               - COALESCE(o.total_paid,0)
               - COALESCE(o.returned_amount,0),
               0
             )
           )
           FROM orders o
           WHERE o.customer_id=$1
             AND COALESCE(o.is_deleted,FALSE)=FALSE
             AND LOWER(COALESCE(o.order_status,'')) NOT IN ('voided','cancelled','canceled')
         ),0)
         - COALESCE((
           SELECT SUM(cp.amount)
           FROM customer_payments cp
           WHERE cp.customer_id=$1
         ),0),
         0
       )::numeric AS current_balance`,
    [id]
  );

  return Number(result.rows[0]?.current_balance || 0);
};

const recomputeCustomerOutstanding = async (client, customerId) => {
  const id = toPositiveIntegerId(customerId);
  if (!id) return null;

  const currentBalance = await computeCustomerOutstanding(client, id);
  const updated = await client.query(
    `UPDATE customers
     SET current_balance=$2,
         updated_at=NOW()
     WHERE id=$1
     RETURNING id,current_balance`,
    [id, currentBalance]
  );

  return updated.rows[0] || null;
};

const recomputeOutstandingForOrder = async (client, centralOrderId) => {
  const orderId = toPositiveIntegerId(centralOrderId);
  if (!orderId) return null;
  const order = await client.query('SELECT customer_id FROM orders WHERE id=$1 LIMIT 1', [orderId]);
  if (order.rowCount === 0 || !order.rows[0]?.customer_id) return null;
  return recomputeCustomerOutstanding(client, order.rows[0].customer_id);
};

module.exports = {
  computeCustomerOutstanding,
  recomputeCustomerOutstanding,
  recomputeOutstandingForOrder,
};
