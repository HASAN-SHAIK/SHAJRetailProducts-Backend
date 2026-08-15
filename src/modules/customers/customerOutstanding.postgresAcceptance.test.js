const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('V1 canonical customer outstanding projection', () => {
  let client;

  const balance = async (customerId = 1) => {
    const result = await client.query('SELECT current_balance FROM customers WHERE id=$1', [customerId]);
    return Number(result.rows[0]?.current_balance || 0);
  };

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`
      DROP TABLE IF EXISTS customer_payments;
      DROP TABLE IF EXISTS orders;
      DROP TABLE IF EXISTS customers;

      CREATE TABLE customers (
        id BIGSERIAL PRIMARY KEY,
        name TEXT,
        current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE orders (
        id BIGSERIAL PRIMARY KEY,
        customer_id BIGINT REFERENCES customers(id),
        total_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
        returned_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        order_status TEXT NOT NULL DEFAULT 'completed',
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE customer_payments (
        id BIGSERIAL PRIMARY KEY,
        customer_id BIGINT NOT NULL REFERENCES customers(id),
        amount NUMERIC(14,2) NOT NULL,
        payment_mode TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO customers(id,name,current_balance) VALUES(1,'Customer One',999);
      SELECT setval(pg_get_serial_sequence('customers','id'),1,true);
    `);

    const migration = fs.readFileSync(
      path.join(__dirname, '../../../Db/migrations/2026-08-15-customer-outstanding-projection.sql'),
      'utf8'
    );
    await client.query(migration);
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  test('migration rebuilds stale balance from durable facts', async () => {
    expect(await balance()).toBe(0);
  });

  test('sale, customer payment and return facts deterministically maintain outstanding', async () => {
    const order = await client.query(
      `INSERT INTO orders(customer_id,total_price,total_paid,returned_amount,order_status)
       VALUES(1,100,20,0,'completed') RETURNING id`
    );
    expect(await balance()).toBe(80);

    await client.query(
      `INSERT INTO customer_payments(customer_id,amount,payment_mode)
       VALUES(1,30,'cash')`
    );
    expect(await balance()).toBe(50);

    // Production partial-return projection refunds 10 of captured principal:
    // paid 20 -> 10 and returned 0 -> 10, leaving order due unchanged at 80.
    await client.query(
      `UPDATE orders SET total_paid=10,returned_amount=10 WHERE id=$1`,
      [order.rows[0].id]
    );
    expect(await balance()).toBe(50);

    await client.query(
      `UPDATE orders SET total_paid=0,returned_amount=100,order_status='returned' WHERE id=$1`,
      [order.rows[0].id]
    );
    expect(await balance()).toBe(0);

    // Lost-ack / duplicate projection cannot apply principal twice.
    await client.query(
      `UPDATE orders SET total_paid=0,returned_amount=100,order_status='returned' WHERE id=$1`,
      [order.rows[0].id]
    );
    expect(await balance()).toBe(0);
  });

  test('late customer mapping and invalidated orders are reflected without event-order dependence', async () => {
    const late = await client.query(
      `INSERT INTO orders(customer_id,total_price,total_paid,returned_amount,order_status)
       VALUES(NULL,60,0,0,'completed') RETURNING id`
    );
    expect(await balance()).toBe(0);

    await client.query('UPDATE orders SET customer_id=1 WHERE id=$1', [late.rows[0].id]);
    // Existing customer payment is applied once against all canonical outstanding facts.
    expect(await balance()).toBe(30);

    await client.query("UPDATE orders SET order_status='voided' WHERE id=$1", [late.rows[0].id]);
    expect(await balance()).toBe(0);
  });
});
