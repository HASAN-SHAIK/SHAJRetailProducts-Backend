const { processPaymentRecorded } = require('./paymentRecorded.processor');

const paymentEvent = () => ({
  event_id: 'evt-payment-1',
  event_type: 'payment.recorded',
  schema_version: 1,
  aggregate_type: 'payment',
  aggregate_id: 'pay-1',
  aggregate_version: 1,
  payload: {
    payment: {
      id: 'pay-1', order_id: 'ord-1', client_payment_id: 'client-pay-1', mode: 'cash', direction: 'in',
      amount_minor: 12500, currency: 'INR', status: 'captured', created_at: '2026-08-07T10:00:00Z'
    },
    summary: { order_id: 'ord-1', total_minor: 12500, paid_minor: 12500, balance_minor: 0, order_status: 'paid' }
  }
});

describe('payment.recorded projection', () => {
  test('projects a valid payment after its sale projection exists', async () => {
    const client = { query: jest.fn(async () => ({ rowCount: 1, rows: [] })) };

    const result = await processPaymentRecorded(client, paymentEvent());
    expect(result).toEqual({ payment_id: 'pay-1', order_id: 'ord-1', status: 'captured' });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(String(client.query.mock.calls[0][0])).toContain('SELECT 1 FROM pos_sales');
    expect(String(client.query.mock.calls[1][0])).toContain('INSERT INTO pos_sale_payments');
    expect(String(client.query.mock.calls[1][0])).toContain('ON CONFLICT(payment_id) DO UPDATE');
  });

  test('defers payment projection until its sale projection exists', async () => {
    const client = { query: jest.fn(async () => ({ rowCount: 0, rows: [] })) };

    await expect(processPaymentRecorded(client, paymentEvent())).resolves.toEqual({
      payment_id: 'pay-1', order_id: 'ord-1', deferred: true, reason: 'sale_projection_missing'
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0][0])).toContain('SELECT 1 FROM pos_sales');
  });

  test('rejects an aggregate id that does not match the payment', async () => {
    const client = { query: jest.fn() };
    await expect(processPaymentRecorded(client, {
      event_type: 'payment.recorded', schema_version: 1, aggregate_type: 'payment', aggregate_id: 'pay-other',
      payload: { payment: { id: 'pay-1' } }
    })).rejects.toMatchObject({ code: 'INVALID_PAYMENT_RECORDED_PAYLOAD' });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('rejects unsupported schema versions', async () => {
    const client = { query: jest.fn() };
    await expect(processPaymentRecorded(client, {
      event_type: 'payment.recorded', schema_version: 2, aggregate_type: 'payment', aggregate_id: 'pay-1', payload: {}
    })).rejects.toMatchObject({ code: 'INVALID_PAYMENT_RECORDED_PAYLOAD' });
  });
});