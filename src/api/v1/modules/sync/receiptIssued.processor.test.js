const { processReceiptIssued } = require('./receiptIssued.processor');

describe('receipt.issued projection', () => {
  test('projects an immutable receipt without requiring a sale row', async () => {
    const client = { query: jest.fn(async () => ({ rowCount: 1, rows: [] })) };
    const event = {
      event_type: 'receipt.issued', schema_version: 1, aggregate_type: 'receipt', aggregate_id: 'rcp-1',
      payload: { receipt: {
        id: 'rcp-1', order_id: 'ord-1', receipt_number: 'STORE-T1-20260807-000001', document_type: 'receipt',
        store_id: 'store-1', terminal_id: 't1', currency: 'INR', total_minor: 12500,
        paid_minor: 12500, balance_minor: 0, snapshot: { order: { id: 'ord-1' } },
        snapshot_sha256: 'abc123', issued_at: '2026-08-07T10:00:00Z'
      } }
    };

    const result = await processReceiptIssued(client, event);
    expect(result).toEqual({ receipt_id: 'rcp-1', order_id: 'ord-1', receipt_number: 'STORE-T1-20260807-000001' });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0][0])).toContain('INSERT INTO pos_sale_receipts');
    expect(client.query.mock.calls[0][1]).toContain('abc123');
  });

  test('rejects aggregate mismatch', async () => {
    const client = { query: jest.fn() };
    await expect(processReceiptIssued(client, {
      event_type: 'receipt.issued', schema_version: 1, aggregate_type: 'receipt', aggregate_id: 'rcp-other',
      payload: { receipt: { id: 'rcp-1' } }
    })).rejects.toMatchObject({ code: 'INVALID_RECEIPT_ISSUED_PAYLOAD' });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('rejects unsupported schema versions', async () => {
    const client = { query: jest.fn() };
    await expect(processReceiptIssued(client, {
      event_type: 'receipt.issued', schema_version: 2, aggregate_type: 'receipt', aggregate_id: 'rcp-1', payload: {}
    })).rejects.toMatchObject({ code: 'INVALID_RECEIPT_ISSUED_PAYLOAD' });
  });
});
