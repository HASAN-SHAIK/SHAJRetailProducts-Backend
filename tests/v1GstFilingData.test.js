jest.mock('../src/db', () => ({
  query: jest.fn(),
  on: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const {
  buildGstSchedules,
  generateGstCsv,
} = require('../src/controllers/gstController');

const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('V1 GST Filing Data and Schedules (FEAT-GST-004)', () => {
  test('routes declare /filing and /export.csv with reports:read permission', () => {
    const routes = source('src/routes/gstRoutes.js');
    expect(routes).toContain("router.get('/filing', requirePermission('reports:read'), getFilingData)");
    expect(routes).toContain("router.get('/export.csv', requirePermission('reports:read'), exportGstCsv)");
  });

  test('buildGstSchedules partitions entries into B2B, B2C Large, B2C Small, and Credit Notes', () => {
    const mockRows = [
      // B2B sale: has customer GSTIN
      {
        id: '11111111-1111-1111-1111-111111111111',
        bill_id: 101,
        order_number: 'ORD-101',
        type: 'SALE',
        taxable_amount: 10000,
        cgst: 900,
        sgst: 900,
        igst: 0,
        total_tax: 1800,
        total_price: 11800,
        customer_name: 'Acme Traders',
        customer_gstin: '36ABCDE1234F1Z5',
        customer_state: 'Telangana',
        date: '2026-11-01',
      },
      // B2C Small sale: no customer GSTIN, intra-state
      {
        id: '22222222-2222-2222-2222-222222222222',
        bill_id: 102,
        order_number: 'ORD-102',
        type: 'SALE',
        taxable_amount: 2000,
        cgst: 180,
        sgst: 180,
        igst: 0,
        total_tax: 360,
        total_price: 2360,
        customer_name: 'Walk-in Cashier',
        customer_gstin: '',
        customer_state: 'Telangana',
        date: '2026-11-02',
      },
      // B2C Large sale: no customer GSTIN, inter-state IGST > 0, invoice value > 250,000
      {
        id: '33333333-3333-3333-3333-333333333333',
        bill_id: 103,
        order_number: 'ORD-103',
        type: 'SALE',
        taxable_amount: 300000,
        cgst: 0,
        sgst: 0,
        igst: 54000,
        total_tax: 54000,
        total_price: 354000,
        customer_name: 'High Value Shopper',
        customer_gstin: '',
        customer_state: 'Karnataka',
        date: '2026-11-03',
      },
      // Credit note: return item
      {
        id: '44444444-4444-4444-4444-444444444444',
        bill_id: 104,
        order_number: 'RET-104',
        type: 'RETURN',
        taxable_amount: 1500,
        cgst: 135,
        sgst: 135,
        igst: 0,
        total_tax: 270,
        total_price: 1770,
        customer_name: 'Acme Traders',
        customer_gstin: '36ABCDE1234F1Z5',
        customer_state: 'Telangana',
        date: '2026-11-04',
      },
    ];

    const schedules = buildGstSchedules(mockRows);

    // Verify schedule groupings
    expect(schedules.b2b).toHaveLength(1);
    expect(schedules.b2b[0].orderNumber).toBe('ORD-101');
    expect(schedules.b2b[0].customerGstin).toBe('36ABCDE1234F1Z5');

    expect(schedules.b2c_small).toHaveLength(1);
    expect(schedules.b2c_small[0].orderNumber).toBe('ORD-102');

    expect(schedules.b2c_large).toHaveLength(1);
    expect(schedules.b2c_large[0].orderNumber).toBe('ORD-103');

    expect(schedules.credit_notes).toHaveLength(1);
    expect(schedules.credit_notes[0].orderNumber).toBe('RET-104');

    // Verify calculated totals
    expect(schedules.totals.b2b.taxable).toBe(10000);
    expect(schedules.totals.b2b.totalTax).toBe(1800);
    expect(schedules.totals.b2c_small.taxable).toBe(2000);
    expect(schedules.totals.b2c_large.taxable).toBe(300000);
    expect(schedules.totals.credit_notes.taxable).toBe(1500);

    // Net taxable: (10000 + 2000 + 300000) - 1500 = 310500
    expect(schedules.totals.net.taxable).toBe(310500);
  });

  test('generateGstCsv formats structured CSV rows with valid escaping', () => {
    const mockSchedules = {
      b2b: [
        {
          orderNumber: 'INV-001',
          date: '2026-11-05',
          customerName: 'Shah, Sons & Co.',
          customerGstin: '29ABCDE1234F2Z6',
          placeOfSupply: 'Karnataka',
          taxableAmount: 5000,
          cgst: 0,
          sgst: 0,
          igst: 900,
          totalTax: 900,
          invoiceTotal: 5900,
        },
      ],
      b2c_large: [],
      b2c_small: [
        {
          orderNumber: 'RET-002',
          date: '2026-11-05',
          customerName: 'Retail Walk-in',
          customerGstin: '',
          placeOfSupply: 'Intra-State',
          taxableAmount: 100,
          cgst: 9,
          sgst: 9,
          igst: 0,
          totalTax: 18,
          invoiceTotal: 118,
        },
      ],
      credit_notes: [],
    };

    const csv = generateGstCsv(mockSchedules);
    expect(csv).toContain('Schedule,Invoice / Return No,Date,Customer Name,Customer GSTIN,Place of Supply,Taxable Value,CGST,SGST,IGST,Total Tax,Invoice Total');
    expect(csv).toContain('"Shah, Sons & Co."');
    expect(csv).toContain('B2B (Table 4)');
    expect(csv).toContain('B2C Small (Table 7)');
  });
});
