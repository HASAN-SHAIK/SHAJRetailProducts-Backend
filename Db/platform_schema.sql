CREATE TABLE shop_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    config JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  shop_name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255),
  email VARCHAR(255),
  mobile VARCHAR(15),
  domain VARCHAR(255) UNIQUE NOT NULL,
  database_name VARCHAR(255) UNIQUE NOT NULL,
  plan_type VARCHAR(20) NOT NULL DEFAULT 'basic',
  addons JSONB DEFAULT '{}'::jsonb,
  gst_mode VARCHAR(20) DEFAULT 'INCLUSIVE',
  is_active BOOLEAN DEFAULT TRUE,
  shop_type_id INT REFERENCES shop_types(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);



ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS gst_mode VARCHAR(20) DEFAULT 'INCLUSIVE';

CREATE TABLE IF NOT EXISTS tenant_config (
  tenant_id INT PRIMARY KEY,
  require_customer_details BOOLEAN DEFAULT FALSE,
  enable_weight_based BOOLEAN DEFAULT FALSE,
  enable_credit_sales BOOLEAN DEFAULT FALSE,
  enable_barcode BOOLEAN DEFAULT FALSE,
  enable_reports BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  plan_id INT,
  start_date DATE,
  end_date DATE,
  amount DECIMAL(10,2),
  payment_status VARCHAR(50),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS platform_admins (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  password TEXT,
  role VARCHAR(50) DEFAULT 'platform_admin',
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  duration_days INT DEFAULT 30,
  features JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_tenants_addons_gin
ON tenants USING GIN (addons);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL,
  plan_id INT,
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'paid',
  payment_method VARCHAR(50),
  paid_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS platform_activity_logs (
  id SERIAL PRIMARY KEY,
  admin_id INT,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS global_products (
  id SERIAL PRIMARY KEY,
  barcode VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255),
  company VARCHAR(255),
  category VARCHAR(255),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_global_products_barcode
ON global_products (barcode);


CREATE TABLE support_cases (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50), -- billing / technical / feature_request / bug
  priority VARCHAR(20) DEFAULT 'medium', -- low / medium / high / urgent
  status VARCHAR(20) DEFAULT 'open', -- open / in_progress / resolved / closed
  assigned_to INT, -- admin user id
  created_by INT, -- tenant user id
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE support_case_messages (
  id SERIAL PRIMARY KEY,
  case_id INT NOT NULL,
  sender_type VARCHAR(20), -- tenant / admin
  sender_id INT,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES support_cases(id) ON DELETE CASCADE
);

CREATE TABLE support_case_attachments (
  id SERIAL PRIMARY KEY,
  case_id INT NOT NULL,
  file_url TEXT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES support_cases(id) ON DELETE CASCADE
);


-- Features list
-- "advanced_reports" -> From Pro
-- "analytical_reports" -> In Premium
-- "api_access" -> In Premium
-- "enable_piece_based" -> from basic
-- "enable_weight_based" -> from basic
-- "is_order_based" -> from basic
-- "max_users" -> basic - 1, pro - 5, premium - 20
-- "multi_branch" -> In Premium
-- "priority_support" -> In Premium
-- "customer_details_enabled" -> From Pro
-- "GST_invoice_enabled" -> from Pro


-- Features list
-- "advanced_reports" -> show revenue overview, growth & Comparison, Sales Trend,Category&Top Products
-- "analytical_reports" -> Inventory intelligence, customer&credit and smart insights
-- "enable_piece_based" -> if enabled piece based products can be added and sold
-- "enable_weight_based" -> if enabled weight based products can be added and sold
-- "is_order_based" -> It relates to manufactur the item after receiving the order. If enabled, it will allow users to create orders even if the stock is not available, and the stock will be updated once the order is placed. 
-- "max_users" -> basic - 1, pro - 5, premium - 20
-- "priority_support" -> If true then the mail should be sent to our email as important otherwise no; Add an option in the left side navbar below Smart Insights with the name "Contact Support" and on click it should open the mail app with our support email address pre-filled in the "To" field and the subject should be "Support Request from [Tenant's Shop Name]".
-- "customer_details_enabled" -> If true then while creating an order, the user should be prompted to either select an existing customer or add new customer details (name, mobile number, and address(optional)). This information should be stored in the customers table and linked to the orders.
-- "GST_invoice_enabled" -> The user should have the option to generate GST invoices for orders. If enabled, the invoice should include GST details based on the products in the order and the shop's GST number. The invoice should be generated in PDF format and should be downloadable from the order details page. It should be present when particular order is seleted and in the order details page there should be a button "Download Invoice" if GST_invoice_enabled is true. On clicking that button the invoice should be downloaded in PDF format.

CREATE TABLE IF NOT EXISTS support_cases (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) CHECK (category IN ('billing', 'technical', 'bug', 'feature_request')),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to INT,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  resolved_at TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS support_case_messages (
  id SERIAL PRIMARY KEY,
  case_id INT NOT NULL,
  sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('tenant', 'admin')),
  sender_id INT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (case_id) REFERENCES support_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS support_case_attachments (
  id SERIAL PRIMARY KEY,
  case_id INT NOT NULL,
  file_url TEXT,
  uploaded_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (case_id) REFERENCES support_cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_cases_tenant_id ON support_cases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_cases_status ON support_cases(status);
CREATE INDEX IF NOT EXISTS idx_support_cases_priority ON support_cases(priority);
