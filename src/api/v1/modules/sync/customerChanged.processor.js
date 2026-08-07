const fail = (message) => {
  const error = new Error(message);
  error.code = 'INVALID_CUSTOMER_CHANGED_PAYLOAD';
  throw error;
};

const requiredString = (value, name) => {
  const result = String(value || '').trim();
  if (!result) fail(`${name} is required`);
  return result;
};

const integer = (value, name) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) fail(`${name} must be an integer`);
  return result;
};

const processCustomerChanged = async (client, event) => {
  if (event.schema_version !== 1) fail('unsupported customer.changed schema_version');
  if (event.aggregate_type !== 'customer') fail('aggregate_type must be customer');
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('payload must be an object');
  const customer = payload.customer;
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) fail('payload.customer must be an object');

  const customerId = requiredString(customer.id, 'customer.id');
  if (customerId !== event.aggregate_id) fail('aggregate_id must match customer.id');
  const localVersion = integer(customer.local_version, 'customer.local_version');
  if (localVersion !== event.aggregate_version) fail('aggregate_version must match customer.local_version');

  await client.query(
    `INSERT INTO pos_customers(
       customer_id,customer_code,name,phone,email,tax_id,credit_limit_minor,outstanding_minor,
       currency,status,local_version,source_updated_at,source_event_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT(customer_id) DO UPDATE SET
       customer_code=EXCLUDED.customer_code,
       name=EXCLUDED.name,
       phone=EXCLUDED.phone,
       email=EXCLUDED.email,
       tax_id=EXCLUDED.tax_id,
       credit_limit_minor=EXCLUDED.credit_limit_minor,
       outstanding_minor=EXCLUDED.outstanding_minor,
       currency=EXCLUDED.currency,
       status=EXCLUDED.status,
       local_version=EXCLUDED.local_version,
       source_updated_at=EXCLUDED.source_updated_at,
       source_event_id=EXCLUDED.source_event_id,
       updated_at=NOW()
     WHERE pos_customers.local_version <= EXCLUDED.local_version`,
    [
      customerId,
      customer.customer_code || null,
      requiredString(customer.name, 'customer.name'),
      customer.phone || null,
      customer.email || null,
      customer.tax_id || null,
      integer(customer.credit_limit_minor, 'customer.credit_limit_minor'),
      integer(customer.outstanding_minor, 'customer.outstanding_minor'),
      requiredString(customer.currency, 'customer.currency'),
      requiredString(customer.status, 'customer.status'),
      localVersion,
      customer.updated_at || null,
      event.event_id,
    ]
  );

  return { customer_id: customerId, local_version: localVersion };
};

module.exports = { processCustomerChanged };
