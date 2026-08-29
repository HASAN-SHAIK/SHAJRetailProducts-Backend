-- CustomerHub/POS demo seed
-- Run after tenant_schema.sql:
-- psql -U postgres -d inventory_db -f ./Db/seed.sql

TRUNCATE TABLE
  order_return_items,
  order_returns,
  transactions,
  order_items,
  orders,
  batches,
  customers,
  branch_devices,
  branches,
  products,
  users
RESTART IDENTITY CASCADE;

INSERT INTO branches (id, store_number, name, location, subscription_plan, max_devices_allowed, is_active) VALUES
('11111111-1111-4111-8111-111111111111', 'STORE01', 'SHAJ Central Store', 'Bengaluru', 'premium', 4, TRUE),
('22222222-2222-4222-8222-222222222222', 'STORE02', 'SHAJ Market Store', 'Mysuru', 'premium', 3, TRUE);

INSERT INTO users (name, email, password, role, branch_id, all_branch_access) VALUES
('Admin User', 'admin@shajretail.local', '$2b$10$seededPasswordHashForLocalDemoOnly', 'admin', NULL, TRUE),
('Store 01 Cashier', 'cashier01@shajretail.local', '$2b$10$seededPasswordHashForLocalDemoOnly', 'cashier', '11111111-1111-4111-8111-111111111111', FALSE),
('Store 02 Cashier', 'cashier02@shajretail.local', '$2b$10$seededPasswordHashForLocalDemoOnly', 'cashier', '22222222-2222-4222-8222-222222222222', FALSE);

INSERT INTO products (name, category, barcode, selling_price, purchase_price, company, stock_quantity, is_deleted, time_for_delivery, gst_percentage, mrp, branch_id) VALUES
('SHAJ Premium Rice 5kg', 'Grocery', '8909001000011', 475.00, 410.00, 'SHAJ Foods', 84.00, FALSE, 3, 5.00, 499.00, NULL),
('SHAJ Sunflower Oil 1L', 'Grocery', '8909001000028', 145.00, 118.00, 'SHAJ Foods', 128.00, FALSE, 3, 5.00, 155.00, NULL),
('SHAJ Masala Tea 250g', 'Beverages', '8909001000035', 110.00, 82.00, 'SHAJ Beverages', 72.00, FALSE, 2, 5.00, 120.00, NULL),
('SHAJ Detergent Powder 1kg', 'Household', '8909001000042', 92.00, 68.00, 'SHAJ Home Care', 66.00, FALSE, 4, 18.00, 99.00, NULL),
('SHAJ Coconut Hair Oil 200ml', 'Personal Care', '8909001000059', 105.00, 74.00, 'SHAJ Personal Care', 58.00, FALSE, 5, 18.00, 115.00, NULL),
('SHAJ Milk Biscuits 120g', 'Snacks', '8909001000066', 28.00, 18.00, 'SHAJ Snacks', 210.00, FALSE, 2, 18.00, 30.00, NULL),
('Premium Basmati Rice 5kg', 'Grocery', '8901000000014', 690.00, 580.00, 'Royal Harvest', 84.00, FALSE, 4, 5.00, 760.00, NULL),
('Organic Wheat Atta 10kg', 'Grocery', '8901000000021', 520.00, 430.00, 'Farm Fresh', 12.00, FALSE, 3, 5.00, 560.00, NULL),
('LED Bulb 12W', 'Electrical', '8901000000038', 160.00, 105.00, 'BrightLite', 5.00, FALSE, 5, 12.00, 190.00, NULL),
('Smartphone Charger Type-C', 'Electronics', '8901000000045', 499.00, 310.00, 'VoltMax', 42.00, FALSE, 6, 18.00, 599.00, NULL);

INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, mrp, quantity, quantity_remaining) VALUES
(1, '11111111-1111-4111-8111-111111111111', 'RICE-A1', CURRENT_DATE + INTERVAL '12 months', 410.00, 475.00, 499.00, 50, 42),
(2, '11111111-1111-4111-8111-111111111111', 'OIL-B2', CURRENT_DATE + INTERVAL '8 months', 118.00, 145.00, 155.00, 80, 73),
(3, '11111111-1111-4111-8111-111111111111', 'TEA-C3', CURRENT_DATE + INTERVAL '10 months', 82.00, 110.00, 120.00, 48, 44),
(4, '11111111-1111-4111-8111-111111111111', 'DET-D4', CURRENT_DATE + INTERVAL '16 months', 68.00, 92.00, 99.00, 40, 36),
(5, '22222222-2222-4222-8222-222222222222', 'HAIR-E5', CURRENT_DATE + INTERVAL '18 months', 74.00, 105.00, 115.00, 36, 32),
(6, '22222222-2222-4222-8222-222222222222', 'BIS-F6', CURRENT_DATE + INTERVAL '7 months', 18.00, 28.00, 30.00, 120, 109),
(7, '22222222-2222-4222-8222-222222222222', 'BAS-A1', CURRENT_DATE + INTERVAL '12 months', 580.00, 690.00, 760.00, 30, 27),
(10, '22222222-2222-4222-8222-222222222222', 'CHG-C1', CURRENT_DATE + INTERVAL '24 months', 310.00, 499.00, 599.00, 25, 21);

INSERT INTO customers (name, mobile, phone, type, location, address, shop_name, gst_number, credit_limit, current_balance, is_active) VALUES
('Walk-in Customer', NULL, NULL, 'retail', 'Bengaluru', NULL, NULL, NULL, 0, 0, TRUE),
('Ananya Sharma', '9876500011', '9876500011', 'retail', 'Bengaluru', 'Indiranagar, Bengaluru', NULL, NULL, 5000, 850, TRUE),
('Kiran Stores', '9876500022', '9876500022', 'wholesale', 'Mysuru', 'Devaraja Market, Mysuru', 'Kiran Stores', '29ABCDE1234F1Z5', 25000, 0, TRUE),
('Mohan Kumar', '9876500033', '9876500033', 'retail', 'Bengaluru', 'Jayanagar, Bengaluru', NULL, NULL, 2000, 980, TRUE);

INSERT INTO orders (user_id, customer_id, branch_id, total_price, total_paid, order_status, transaction_type, billing_type, location, product_summary, product_count, payment_mode, is_gst_enabled, gst_mode, returned_amount, created_at, completed_at) VALUES
(2, 1, '11111111-1111-4111-8111-111111111111', 4200.00, 4200.00, 'completed', 'sale', 'retail', 'Bengaluru', 'SHAJ Premium Rice 5kg, SHAJ Sunflower Oil 1L, SHAJ Milk Biscuits 120g', 8, 'cash', TRUE, 'INCLUSIVE', 0, CURRENT_DATE + TIME '10:15', CURRENT_DATE + TIME '10:17'),
(2, 2, '11111111-1111-4111-8111-111111111111', 1850.00, 1000.00, 'completed', 'sale', 'retail', 'Bengaluru', 'SHAJ Masala Tea 250g, SHAJ Detergent Powder 1kg', 4, 'credit', TRUE, 'INCLUSIVE', 0, CURRENT_DATE - INTERVAL '1 day' + TIME '16:20', CURRENT_DATE - INTERVAL '1 day' + TIME '16:22'),
(3, 3, '22222222-2222-4222-8222-222222222222', 7200.00, 7200.00, 'completed', 'sale', 'wholesale', 'Mysuru', 'Premium Basmati Rice 5kg, Smartphone Charger Type-C, SHAJ Coconut Hair Oil 200ml', 14, 'online', TRUE, 'INCLUSIVE', 92.00, CURRENT_DATE - INTERVAL '2 days' + TIME '12:05', CURRENT_DATE - INTERVAL '2 days' + TIME '12:08'),
(2, 4, '11111111-1111-4111-8111-111111111111', 980.00, 0.00, 'pending', 'sale', 'retail', 'Bengaluru', 'SHAJ Sunflower Oil 1L, SHAJ Milk Biscuits 120g', 3, 'credit', TRUE, 'INCLUSIVE', 0, CURRENT_DATE - INTERVAL '3 days' + TIME '18:45', NULL),
(3, 1, '22222222-2222-4222-8222-222222222222', 1325.00, 1325.00, 'completed', 'sale', 'retail', 'Mysuru', 'SHAJ Coconut Hair Oil 200ml, SHAJ Milk Biscuits 120g', 6, 'cash', TRUE, 'INCLUSIVE', 0, CURRENT_DATE - INTERVAL '8 days' + TIME '11:30', CURRENT_DATE - INTERVAL '8 days' + TIME '11:32'),
(2, 2, '11111111-1111-4111-8111-111111111111', 2550.00, 2550.00, 'completed', 'sale', 'retail', 'Bengaluru', 'SHAJ Premium Rice 5kg, Organic Wheat Atta 10kg', 5, 'bank', TRUE, 'INCLUSIVE', 0, CURRENT_DATE - INTERVAL '18 days' + TIME '14:10', CURRENT_DATE - INTERVAL '18 days' + TIME '14:14');

INSERT INTO order_items (order_id, product_id, quantity, selling_price, purchase_price_snapshot, discount_amount, gst_percent, profit, margin_percent) VALUES
(1, 1, 4, 475.00, 410.00, 0, 5.00, 260.00, 13.68),
(1, 2, 2, 145.00, 118.00, 0, 5.00, 54.00, 18.62),
(1, 6, 2, 28.00, 18.00, 0, 18.00, 20.00, 35.71),
(2, 3, 2, 110.00, 82.00, 0, 5.00, 56.00, 25.45),
(2, 4, 2, 92.00, 68.00, 0, 18.00, 48.00, 26.09),
(3, 7, 3, 690.00, 580.00, 0, 5.00, 330.00, 15.94),
(3, 10, 4, 499.00, 310.00, 0, 18.00, 756.00, 37.88),
(3, 5, 7, 105.00, 74.00, 0, 18.00, 217.00, 29.52),
(4, 2, 1, 145.00, 118.00, 0, 5.00, 27.00, 18.62),
(4, 6, 2, 28.00, 18.00, 0, 18.00, 20.00, 35.71),
(5, 5, 4, 105.00, 74.00, 0, 18.00, 124.00, 29.52),
(5, 6, 2, 28.00, 18.00, 0, 18.00, 20.00, 35.71),
(6, 1, 3, 475.00, 410.00, 0, 5.00, 195.00, 13.68),
(6, 8, 2, 520.00, 430.00, 0, 5.00, 180.00, 17.31);

INSERT INTO transactions (order_id, total_price, profit, payment_mode, amount, party_type, party_id, direction, txn_type, transaction_type, notes, branch_id, created_at) VALUES
(1, 4200.00, 334.00, 'cash', 4200.00, 'customer', 1, 'in', 'sale', 'payment', 'Seed sale payment', '11111111-1111-4111-8111-111111111111', CURRENT_DATE + TIME '10:17'),
(2, 1000.00, 104.00, 'credit', 1000.00, 'customer', 2, 'in', 'sale', 'payment', 'Partial credit receipt', '11111111-1111-4111-8111-111111111111', CURRENT_DATE - INTERVAL '1 day' + TIME '16:22'),
(3, 7200.00, 1303.00, 'online', 7200.00, 'customer', 3, 'in', 'sale', 'payment', 'UPI sale payment', '22222222-2222-4222-8222-222222222222', CURRENT_DATE - INTERVAL '2 days' + TIME '12:08'),
(5, 1325.00, 144.00, 'cash', 1325.00, 'customer', 1, 'in', 'sale', 'payment', 'Seed sale payment', '22222222-2222-4222-8222-222222222222', CURRENT_DATE - INTERVAL '8 days' + TIME '11:32'),
(6, 2550.00, 375.00, 'bank', 2550.00, 'customer', 2, 'in', 'sale', 'payment', 'Bank sale payment', '11111111-1111-4111-8111-111111111111', CURRENT_DATE - INTERVAL '18 days' + TIME '14:14');

INSERT INTO order_returns (order_id, customer_id, refund_total, refund_mode, reason, created_by, return_uuid, tax_reversed, created_at) VALUES
(3, 3, 92.00, 'online', 'Damaged detergent pack returned during delivery audit', 1, gen_random_uuid(), 14.03, CURRENT_DATE - INTERVAL '1 day' + TIME '13:00');

INSERT INTO order_return_items (return_id, product_id, quantity, unit_price, line_total, gst_amount) VALUES
(1, 4, 1, 92.00, 92.00, 14.03);

INSERT INTO transactions (order_id, total_price, profit, payment_mode, amount, party_type, party_id, direction, txn_type, transaction_type, reference_id, notes, branch_id, created_at) VALUES
(3, -92.00, -24.00, 'online', 92.00, 'customer', 3, 'out', 'refund', 'refund', 1, 'Seed return refund', '22222222-2222-4222-8222-222222222222', CURRENT_DATE - INTERVAL '1 day' + TIME '13:05');

INSERT INTO coupons (code, discount_type, discount_value, isActive, expires_at)
VALUES
('FLAT100', 'flat', 100, true, NOW() + INTERVAL '1 year'),
('FLAT200', 'flat', 200, true, NOW() + INTERVAL '1 year'),
('PERC5', 'percentage', 5, true, NOW() + INTERVAL '1 year'),
('PERC10', 'percentage', 10, true, NOW() + INTERVAL '1 year')
ON CONFLICT (code) DO NOTHING;
