const { processSaleCompleted } = require('./saleCompleted.processor');

describe('V1 POS sale category snapshot projection', () => {
  test('persists the POS sale-time category snapshot into canonical and compatibility sale items', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (text, params = []) => {
        calls.push({ text, params });
        if (/INSERT INTO orders\(/.test(text)) {
          return { rowCount: 1, rows: [{ id: 41, source_version: 1 }] };
        }
        return { rowCount: 1, rows: [] };
      }),
    };

    const event = {
      event_id: 'evt-sale-category-1',
      aggregate_id: 'ord-local-1',
      payload: {
        actor: { user_id: 'cashier-1' },
        order: {
          id: 'ord-local-1',
          client_order_id: 'client-ord-1',
          customer_id: null,
          store_id: 'store-a',
          terminal_id: 'terminal-1',
          status: 'completed',
          currency: 'INR',
          subtotal_minor: 10000,
          discount_minor: 0,
          tax_minor: 0,
          total_minor: 10000,
          version: 1,
          created_at: '2026-08-18T10:00:00.000Z',
          updated_at: '2026-08-18T10:00:00.000Z',
          completed_at: '2026-08-18T10:00:00.000Z',
          items: [
            {
              id: 'item-local-1',
              line_no: 1,
              product_id: '101',
              sku: 'SKU-101',
              product_name: 'Cola',
              barcode: '890000000101',
              category_id: 'cat-beverages',
              category_name: 'Beverages',
              quantity_milli: 1000,
              unit_price_minor: 10000,
              discount_minor: 0,
              taxable_minor: 10000,
              gst_rate_bps: 0,
              tax_minor: 0,
              line_total_minor: 10000,
              tax_code: null,
            },
          ],
        },
        receipt: {
          id: 'receipt-1',
          receipt_number: 'R-1',
          document_type: 'sale',
          store_id: 'store-a',
          terminal_id: 'terminal-1',
          customer_id: null,
          currency: 'INR',
          total_minor: 10000,
          paid_minor: 10000,
          balance_minor: 0,
          snapshot: {},
          snapshot_sha256: 'abc123',
          issued_at: '2026-08-18T10:00:00.000Z',
        },
        payments: [],
        inventory_movements: [],
      },
    };

    await processSaleCompleted(client, event);

    const canonicalItem = calls.find(({ text }) => /INSERT INTO order_items\(/.test(text));
    expect(canonicalItem).toBeDefined();
    expect(canonicalItem.text).toContain('category_id_snapshot');
    expect(canonicalItem.text).toContain('category_name_snapshot');
    expect(canonicalItem.params.slice(-2)).toEqual(['cat-beverages', 'Beverages']);

    const compatibilityItem = calls.find(({ text }) => /INSERT INTO pos_sale_items\(/.test(text));
    expect(compatibilityItem).toBeDefined();
    expect(compatibilityItem.text).toContain('category_id_snapshot');
    expect(compatibilityItem.text).toContain('category_name_snapshot');
    expect(compatibilityItem.params.slice(-2)).toEqual(['cat-beverages', 'Beverages']);
  });
});
