const { Client } = require('pg');
const { processSaleReturned } = require('./saleReturned.processor');
const { processSalePartialReturned } = require('./salePartialReturned.processor');

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('V1 POS return balance facts on PostgreSQL', () => {
  let client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`
      DROP TABLE IF EXISTS pos_partial_return_items;
      DROP TABLE IF EXISTS pos_partial_returns;
      DROP TABLE IF EXISTS order_items;
      DROP TABLE IF EXISTS pos_sales;
      DROP TABLE IF EXISTS orders;

      CREATE TABLE orders (
        id BIGSERIAL PRIMARY KEY,
        source_channel TEXT,
        source_order_id TEXT,
        source_event_id TEXT,
        source_version INT,
        order_status TEXT NOT NULL DEFAULT 'completed',
        total_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
        returned_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        source_refunded_by_user_id TEXT,
        source_refund_approved_by_user_id TEXT,
        source_refund_reason TEXT,
        source_returned_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX ux_test_orders_source ON orders(source_channel, source_order_id);

      CREATE TABLE pos_sales (
        order_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'completed',
        version INT NOT NULL DEFAULT 1,
        source_updated_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE order_items (
        id BIGSERIAL PRIMARY KEY,
        order_id BIGINT NOT NULL REFERENCES orders(id),
        source_item_id TEXT NOT NULL,
        quantity_milli BIGINT NOT NULL,
        source_returned_quantity_milli BIGINT NOT NULL DEFAULT 0,
        source_refunded_minor BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE pos_partial_returns (
        return_id TEXT PRIMARY KEY,
        order_id BIGINT NOT NULL REFERENCES orders(id),
        source_order_id TEXT NOT NULL,
        source_version INT NOT NULL,
        refund_minor BIGINT NOT NULL,
        refunded_by_user_id TEXT,
        approved_by_user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        source_returned_at TIMESTAMPTZ
      );

      CREATE TABLE pos_partial_return_items (
        return_id TEXT NOT NULL REFERENCES pos_partial_returns(return_id),
        source_item_id TEXT NOT NULL,
        quantity_milli BIGINT NOT NULL,
        refund_minor BIGINT NOT NULL
      );
    `);
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  test('full return projects returned principal exactly once with distinct refund actors', async () => {
    await client.query(`
      INSERT INTO orders(source_channel,source_order_id,source_version,order_status,total_price,total_paid,returned_amount)
      VALUES('pos','ord-full',1,'completed',100.00,100.00,0);
      INSERT INTO pos_sales(order_id,status,version) VALUES('ord-full','completed',1);
    `);

    const event = {
      event_id: 'evt-full-return',
      schema_version: 1,
      aggregate_type: 'sales_order',
      aggregate_id: 'ord-full',
      aggregate_version: 2,
      payload: {
        order: { id: 'ord-full', version: 2, status: 'returned', updated_at: '2026-08-15T00:00:00Z' },
        refunded_by_user_id: 'cashier-1',
        approved_by_user_id: 'manager-1',
        approval_reason: 'customer returned full sale',
      },
    };

    await client.query('BEGIN');
    try {
      await processSaleReturned(client, event);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const first = await client.query("SELECT total_price,total_paid,returned_amount,order_status,source_version,source_refunded_by_user_id,source_refund_approved_by_user_id FROM orders WHERE source_order_id='ord-full'");
    expect(first.rows[0]).toMatchObject({
      order_status: 'returned',
      source_version: 2,
      source_refunded_by_user_id: 'cashier-1',
      source_refund_approved_by_user_id: 'manager-1',
    });
    expect(Number(first.rows[0].total_price)).toBe(100);
    expect(Number(first.rows[0].total_paid)).toBe(0);
    expect(Number(first.rows[0].returned_amount)).toBe(100);

    await processSaleReturned(client, event);
    const replay = await client.query("SELECT total_paid,returned_amount,source_refunded_by_user_id,source_refund_approved_by_user_id FROM orders WHERE source_order_id='ord-full'");
    expect(Number(replay.rows[0].total_paid)).toBe(0);
    expect(Number(replay.rows[0].returned_amount)).toBe(100);
    expect(replay.rows[0].source_refunded_by_user_id).toBe('cashier-1');
    expect(replay.rows[0].source_refund_approved_by_user_id).toBe('manager-1');
  });

  test('partial return accumulates immutable refund principal once and preserves distinct actors', async () => {
    const inserted = await client.query(`
      INSERT INTO orders(source_channel,source_order_id,source_version,order_status,total_price,total_paid,returned_amount)
      VALUES('pos','ord-partial',1,'completed',100.00,100.00,0)
      RETURNING id;
    `);
    const orderId = inserted.rows[0].id;
    await client.query("INSERT INTO pos_sales(order_id,status,version) VALUES('ord-partial','completed',1)");
    await client.query(
      'INSERT INTO order_items(order_id,source_item_id,quantity_milli) VALUES($1,$2,$3)',
      [orderId, 'item-1', 1000]
    );

    const event = {
      event_id: 'evt-partial-return',
      schema_version: 1,
      aggregate_type: 'sales_order',
      aggregate_id: 'ord-partial',
      aggregate_version: 2,
      payload: {
        order: { id: 'ord-partial', version: 2, status: 'completed', updated_at: '2026-08-15T00:01:00Z' },
        return_id: 'ret-partial-1',
        refund_minor: 2500,
        refunded_by_user_id: 'cashier-2',
        approved_by_user_id: 'manager-2',
        approval_reason: 'customer returned one quarter',
        returned_at: '2026-08-15T00:01:00Z',
        lines: [{ order_item_id: 'item-1', quantity_milli: 250, refund_minor: 2500 }],
      },
    };

    await client.query('BEGIN');
    try {
      const applied = await processSalePartialReturned(client, event);
      expect(applied.canonical_applied).toBe(true);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const first = await client.query("SELECT total_price,total_paid,returned_amount,source_version FROM orders WHERE source_order_id='ord-partial'");
    expect(Number(first.rows[0].total_price)).toBe(100);
    expect(Number(first.rows[0].total_paid)).toBe(75);
    expect(Number(first.rows[0].returned_amount)).toBe(25);
    expect(first.rows[0].source_version).toBe(2);

    const actorFacts = await client.query("SELECT refunded_by_user_id,approved_by_user_id FROM pos_partial_returns WHERE return_id='ret-partial-1'");
    expect(actorFacts.rows[0]).toMatchObject({
      refunded_by_user_id: 'cashier-2',
      approved_by_user_id: 'manager-2',
    });

    const replayed = await processSalePartialReturned(client, event);
    expect(replayed.replayed).toBe(true);
    const replay = await client.query("SELECT total_paid,returned_amount FROM orders WHERE source_order_id='ord-partial'");
    expect(Number(replay.rows[0].total_paid)).toBe(75);
    expect(Number(replay.rows[0].returned_amount)).toBe(25);
  });
});
