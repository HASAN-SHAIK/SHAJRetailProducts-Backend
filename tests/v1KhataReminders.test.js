jest.mock('../src/db', () => ({
  query: jest.fn(),
  on: jest.fn(),
}));

const {
  handleSendReminder,
  handleGetReminders,
} = require('../src/modules/customers/controller');

describe('V1 Automated SMS & Messaging Payment Reminders for Khata Debtors (FEAT-COMM-003)', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
  });

  test('rejects reminder if customer has no outstanding debt', async () => {
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 12,
          name: 'Anil Sharma',
          phone: '9876543210',
          current_balance: 0,
          credit_balance: 0,
        },
      ],
    });

    const req = {
      tenantPool: mockPool,
      params: { id: 12 },
      body: {},
      user: { id: 1, username: 'cashier1' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await handleSendReminder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'REMINDER_DISPATCH_FAILED',
        message: expect.stringContaining('no outstanding balance to remind'),
      })
    );
  });

  test('rejects reminder if customer has no phone number', async () => {
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 15,
          name: 'Walk-in Credit',
          phone: null,
          mobile: null,
          current_balance: 1500,
        },
      ],
    });

    const req = {
      tenantPool: mockPool,
      params: { id: 15 },
      body: {},
      user: { id: 1, username: 'cashier1' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await handleSendReminder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('no phone number on record'),
      })
    );
  });

  test('successfully generates UPI payment reminder, records audit in customer_reminders, and returns queued state', async () => {
    mockPool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM customers') && sql.includes('WHERE id = $1')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 42,
              name: 'Vikram Seth',
              phone: '9988776655',
              current_balance: 3450.5,
              branch_id: 'b1111111-1111-1111-1111-111111111111',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO customer_reminders')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 501,
              customer_id: 42,
              recipient_phone: '9988776655',
              amount: 3450.5,
              channel: 'sms',
              message_text: params[5],
              upi_link: params[6],
              status: 'SENT',
              sent_at: new Date('2026-11-08T12:00:00Z'),
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const req = {
      tenantPool: mockPool,
      params: { id: 42 },
      body: {
        storeName: 'SHAJ Supermarket',
        upiId: 'shajsupermarket@icici',
        channel: 'sms',
      },
      user: { id: 7, username: 'store_manager' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await handleSendReminder(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.reminder.recipientPhone).toBe('9988776655');
    expect(body.data.reminder.amount).toBe(3450.5);
    expect(body.data.reminder.upiLink).toContain('upi://pay');
    expect(body.data.reminder.upiLink).toContain('pa=shajsupermarket%40icici');
    expect(body.data.reminder.upiLink).toContain('am=3450.50');
    expect(body.data.reminder.messageText).toContain('SHAJ Supermarket');
    expect(body.data.reminder.messageText).toContain('Rs.3450.50');
    expect(body.data.reminder.status).toBe('SENT');
  });

  test('handleGetReminders retrieves past reminder history for debtor', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 501,
          customer_id: 42,
          recipient_phone: '9988776655',
          amount: 3450.5,
          channel: 'sms',
          message_text: 'Reminder text...',
          status: 'SENT',
          sent_at: '2026-11-08T12:00:00Z',
        },
      ],
    });

    const req = { tenantPool: mockPool, params: { id: 42 } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await handleGetReminders(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.reminders.length).toBe(1);
    expect(body.data.reminders[0].status).toBe('SENT');
  });
});
