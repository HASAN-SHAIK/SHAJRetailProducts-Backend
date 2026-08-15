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

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits || null;
};

const isActiveStatus = (value) => String(value || '').trim().toLowerCase() !== 'inactive';

const resolveCanonicalCustomer = async (client, customer, event, localVersion) => {
  const posCustomerId = requiredString(customer.id, 'customer.id');
  const mapped = await client.query(
    'SELECT canonical_customer_id FROM pos_customer_mappings WHERE pos_customer_id=$1 LIMIT 1',
    [posCustomerId]
  );
  if (mapped.rowCount > 0) return Number(mapped.rows[0].canonical_customer_id);

  const phone = normalizePhone(customer.phone);
  let existing;
  if (phone) {
    existing = await client.query(
      `SELECT id FROM customers
       WHERE regexp_replace(COALESCE(phone, mobile, ''), '\\D', '', 'g')=$1
       ORDER BY updated_at DESC NULLS LAST,id DESC
       LIMIT 1`,
      [phone]
    );
  } else {
    existing = await client.query(
      `SELECT id FROM customers
       WHERE LOWER(TRIM(COALESCE(name,'')))=LOWER(TRIM($1))
         AND COALESCE(NULLIF(regexp_replace(COALESCE(phone,mobile,''), '\\D', '', 'g'),''),'')=''
       ORDER BY updated_at DESC NULLS LAST,id DESC
       LIMIT 1`,
      [requiredString(customer.name, 'customer.name')]
    );
  }

  let canonicalCustomerId;
  if (existing.rowCount > 0) {
    canonicalCustomerId = Number(existing.rows[0].id);
  } else {
    const created = await client.query(
      `INSERT INTO customers(
         name,mobile,phone,type,email,gst_number,credit_limit,current_balance,is_active,updated_at
       ) VALUES($1,$2,$2,'retail',$3,$4,0,0,$5,NOW())
       RETURNING id`,
      [
        requiredString(customer.name, 'customer.name'),
        phone,
        customer.email || null,
        customer.tax_id || null,
        isActiveStatus(customer.status),
      ]
    );
    canonicalCustomerId = Number(created.rows[0].id);
  }

  await client.query(
    `INSERT INTO pos_customer_mappings(
       pos_customer_id,canonical_customer_id,source_event_id,source_version
     ) VALUES($1,$2,$3,$4)
     ON CONFLICT(pos_customer_id) DO NOTHING`,
    [posCustomerId, canonicalCustomerId, event.event_id, localVersion]
  );

  const settled = await client.query(
    'SELECT canonical_customer_id FROM pos_customer_mappings WHERE pos_customer_id=$1 LIMIT 1',
    [posCustomerId]
  );
  if (settled.rowCount === 0) {
    const error = new Error('canonical customer mapping could not be resolved');
    error.code = 'CANONICAL_CUSTOMER_MAPPING_FAILED';
    throw error;
  }
  return Number(settled.rows[0].canonical_customer_id);
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

  const projected = await client.query(
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
     WHERE pos_customers.local_version <= EXCLUDED.local_version
     RETURNING customer_id,local_version`,
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

  if (projected.rowCount === 0) {
    const existingMapping = await client.query(
      'SELECT canonical_customer_id FROM pos_customer_mappings WHERE pos_customer_id=$1 LIMIT 1',
      [customerId]
    );
    return {
      customer_id: customerId,
      local_version: localVersion,
      canonical_customer_id: existingMapping.rows[0]?.canonical_customer_id
        ? Number(existingMapping.rows[0].canonical_customer_id)
        : null,
      canonical_applied: false,
    };
  }

  const canonicalCustomerId = await resolveCanonicalCustomer(client, customer, event, localVersion);
  await client.query(
    `UPDATE pos_customer_mappings
     SET source_event_id=$2,
         source_version=GREATEST(source_version,$3)
     WHERE pos_customer_id=$1 AND canonical_customer_id=$4`,
    [customerId, event.event_id, localVersion, canonicalCustomerId]
  );

  const phone = normalizePhone(customer.phone);
  await client.query(
    `UPDATE customers
     SET name=$2,
         mobile=COALESCE($3,mobile),
         phone=COALESCE($3,phone),
         email=COALESCE($4,email),
         gst_number=COALESCE($5,gst_number),
         is_active=$6,
         updated_at=NOW()
     WHERE id=$1`,
    [
      canonicalCustomerId,
      requiredString(customer.name, 'customer.name'),
      phone,
      customer.email || null,
      customer.tax_id || null,
      isActiveStatus(customer.status),
    ]
  );

  // Customer financial authority remains Central: never apply POS credit/outstanding snapshots
  // to customers.credit_limit/current_balance. They remain compatibility/sync observations only.
  await client.query(
    `UPDATE orders
     SET customer_id=$1
     WHERE source_channel='pos' AND source_customer_id=$2 AND customer_id IS NULL`,
    [canonicalCustomerId, customerId]
  );

  return {
    customer_id: customerId,
    local_version: localVersion,
    canonical_customer_id: canonicalCustomerId,
    canonical_applied: true,
  };
};

module.exports = { processCustomerChanged };
