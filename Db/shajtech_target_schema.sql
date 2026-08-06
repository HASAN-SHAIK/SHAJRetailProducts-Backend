-- =============================================================================
-- SHAJTech Target Tenant Schema (PostgreSQL 14+)
-- Production-ready retail schema for IndexedDB → SQL migration.
--
-- Scope: per-tenant database (existing isolation model preserved).
-- Naming: "stores" = branches/shops; sales/purchases split from legacy orders.
-- Run on fresh tenant DB only; use migration scripts for live upgrades.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'inactive', 'locked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_mode AS ENUM ('cash', 'bank', 'upi', 'card', 'credit', 'wallet');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_direction AS ENUM ('in', 'out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE document_status AS ENUM ('draft', 'confirmed', 'partially_paid', 'paid', 'cancelled', 'returned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_movement_type AS ENUM (
    'purchase_receipt', 'sale_issue', 'sale_return', 'purchase_return',
    'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out', 'opening'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE party_type AS ENUM ('customer', 'supplier', 'staff', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('insert', 'update', 'delete', 'login', 'logout', 'sync', 'export', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- STORES (branches)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(32) NOT NULL,
  name            TEXT NOT NULL,
  location        TEXT,
  gst_number      VARCHAR(20),
  address_line1   TEXT,
  address_line2   TEXT,
  city            VARCHAR(100),
  state           VARCHAR(100),
  pincode         VARCHAR(10),
  phone           VARCHAR(20),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  max_devices     INT NOT NULL DEFAULT 3,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stores_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_stores_active_name ON stores (is_active, LOWER(name));

-- ---------------------------------------------------------------------------
-- ROLES & PERMISSIONS (RBAC)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(50) NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_roles_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS permissions (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(100) NOT NULL,
  resource        VARCHAR(50) NOT NULL,
  action          VARCHAR(50) NOT NULL,
  description     TEXT,
  CONSTRAINT uq_permissions_code UNIQUE (code),
  CONSTRAINT uq_permissions_resource_action UNIQUE (resource, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id   INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  store_id            UUID REFERENCES stores(id) ON DELETE SET NULL,
  email               VARCHAR(255) NOT NULL,
  password_hash       TEXT NOT NULL,
  full_name           TEXT NOT NULL,
  phone               VARCHAR(20),
  status              user_status NOT NULL DEFAULT 'active',
  all_store_access    BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_users_store_status ON users (store_id, status);
CREATE INDEX IF NOT EXISTS idx_users_email_active ON users (LOWER(email)) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- CATEGORIES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id              SERIAL PRIMARY KEY,
  parent_id       INT REFERENCES categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  slug            VARCHAR(120) NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_categories_slug UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_sort ON categories (parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_name_trgm ON categories USING GIN (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                  BIGSERIAL PRIMARY KEY,
  category_id         INT REFERENCES categories(id) ON DELETE SET NULL,
  sku                 VARCHAR(64),
  name                TEXT NOT NULL,
  company             TEXT,
  barcode             VARCHAR(50),
  hsn_code            VARCHAR(20),
  gst_percent         NUMERIC(5,2) NOT NULL DEFAULT 0,
  mrp                 NUMERIC(12,2),
  selling_price       NUMERIC(12,2) NOT NULL,
  purchase_price      NUMERIC(12,2),
  is_weight_based     BOOLEAN NOT NULL DEFAULT FALSE,
  is_batch_tracked    BOOLEAN NOT NULL DEFAULT FALSE,
  uom                 VARCHAR(20) NOT NULL DEFAULT 'pcs',
  reorder_level       NUMERIC(12,3) NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  merged_into_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_products_sku UNIQUE (sku),
  CONSTRAINT chk_products_prices CHECK (selling_price >= 0 AND (mrp IS NULL OR mrp >= 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode_active
  ON products (barcode) WHERE barcode IS NOT NULL AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_category_active
  ON products (category_id, is_active) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm_active
  ON products USING GIN (name gin_trgm_ops) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_barcode_lookup
  ON products (barcode) INCLUDE (id, name, selling_price, gst_percent, is_batch_tracked)
  WHERE is_deleted = FALSE AND barcode IS NOT NULL;

-- ---------------------------------------------------------------------------
-- INVENTORY (batches + levels + movements)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  batch_number        VARCHAR(64) NOT NULL,
  expiry_date         DATE,
  purchase_price      NUMERIC(12,2),
  selling_price       NUMERIC(12,2),
  mrp                 NUMERIC(12,2),
  qty_received        NUMERIC(12,3) NOT NULL DEFAULT 0,
  qty_remaining       NUMERIC(12,3) NOT NULL DEFAULT 0,
  purchase_id         BIGINT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_inventory_batches_qty CHECK (qty_remaining >= 0 AND qty_received >= 0),
  CONSTRAINT uq_inventory_batches_product_store_batch UNIQUE (product_id, store_id, batch_number)
);

CREATE TABLE IF NOT EXISTS inventory_levels (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  batch_id            UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
  qty_on_hand         NUMERIC(12,3) NOT NULL DEFAULT 0,
  qty_reserved        NUMERIC(12,3) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_inventory_levels_qty CHECK (qty_on_hand >= 0 AND qty_reserved >= 0),
  CONSTRAINT uq_inventory_levels_product_store_batch UNIQUE (product_id, store_id, batch_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  batch_id            UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
  movement_type       inventory_movement_type NOT NULL,
  qty_delta           NUMERIC(12,3) NOT NULL,
  unit_cost           NUMERIC(12,2),
  reference_type      VARCHAR(50),
  reference_id        BIGINT,
  notes               TEXT,
  created_by          INT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_store
  ON inventory_batches (product_id, store_id, expiry_date);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry
  ON inventory_batches (expiry_date) WHERE qty_remaining > 0;

CREATE INDEX IF NOT EXISTS idx_inventory_levels_product_store
  ON inventory_levels (product_id, store_id) INCLUDE (qty_on_hand, qty_reserved);

CREATE INDEX IF NOT EXISTS idx_inventory_levels_low_stock
  ON inventory_levels (store_id, product_id)
  WHERE qty_on_hand > 0;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_time
  ON inventory_movements (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_ref
  ON inventory_movements (reference_type, reference_id);

-- ---------------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                  BIGSERIAL PRIMARY KEY,
  code                VARCHAR(32),
  name                TEXT NOT NULL,
  mobile              VARCHAR(20),
  phone               VARCHAR(20),
  email               VARCHAR(255),
  customer_type       VARCHAR(20) NOT NULL DEFAULT 'retail'
                      CHECK (customer_type IN ('retail', 'wholesale')),
  shop_name           TEXT,
  gst_number          VARCHAR(20),
  credit_limit        NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  address_line1       TEXT,
  address_line2       TEXT,
  city                VARCHAR(100),
  state               VARCHAR(100),
  pincode             VARCHAR(10),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  is_merged           BOOLEAN NOT NULL DEFAULT FALSE,
  merged_into_id      BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_customers_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers (mobile) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_balance ON customers (current_balance DESC) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- SUPPLIERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            UUID REFERENCES stores(id) ON DELETE SET NULL,
  code                VARCHAR(32),
  name                TEXT NOT NULL,
  mobile              VARCHAR(20),
  email               VARCHAR(255),
  gst_number          VARCHAR(20),
  credit_limit        NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  address_line1       TEXT,
  address_line2       TEXT,
  city                VARCHAR(100),
  state               VARCHAR(100),
  pincode             VARCHAR(10),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_suppliers_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_store_active ON suppliers (store_id, is_active) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING GIN (name gin_trgm_ops) WHERE is_deleted = FALSE;

-- ---------------------------------------------------------------------------
-- SALES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id                      BIGSERIAL PRIMARY KEY,
  store_id                UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  customer_id             BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  cashier_user_id         INT REFERENCES users(id) ON DELETE SET NULL,
  invoice_number          VARCHAR(50),
  client_sale_id          UUID,
  status                  document_status NOT NULL DEFAULT 'confirmed',
  billing_type            VARCHAR(20) NOT NULL DEFAULT 'retail'
                          CHECK (billing_type IN ('retail', 'wholesale')),
  payment_mode            payment_mode,
  subtotal_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  returned_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_gst_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  gst_mode                VARCHAR(20) NOT NULL DEFAULT 'INCLUSIVE',
  customer_name_snapshot  TEXT,
  customer_mobile_snapshot TEXT,
  product_summary         TEXT,
  product_count           INT NOT NULL DEFAULT 0,
  notes                   TEXT,
  sale_date               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT chk_sales_amounts CHECK (
    subtotal_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0 AND returned_amount >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_client_sale_id
  ON sales (client_sale_id) WHERE client_sale_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoice_store
  ON sales (store_id, invoice_number) WHERE invoice_number IS NOT NULL AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_sales_store_date
  ON sales (store_id, sale_date DESC) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_sales_customer_date
  ON sales (customer_id, sale_date DESC) WHERE customer_id IS NOT NULL AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_sales_status_store
  ON sales (store_id, status, sale_date DESC);

-- ---------------------------------------------------------------------------
-- SALE ITEMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_items (
  id                      BIGSERIAL PRIMARY KEY,
  sale_id                 BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id              BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_id                UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
  line_no                 INT NOT NULL,
  quantity                NUMERIC(12,3) NOT NULL,
  unit_price              NUMERIC(12,2) NOT NULL,
  purchase_price_snapshot NUMERIC(12,2),
  discount_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_percent             NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total              NUMERIC(14,2) NOT NULL,
  profit_amount           NUMERIC(14,2),
  margin_percent          NUMERIC(7,2),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sale_items_sale_line UNIQUE (sale_id, line_no),
  CONSTRAINT chk_sale_items_qty CHECK (quantity > 0),
  CONSTRAINT chk_sale_items_amounts CHECK (unit_price >= 0 AND line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- PURCHASES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id                      BIGSERIAL PRIMARY KEY,
  store_id                UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  supplier_id             BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  created_by_user_id      INT REFERENCES users(id) ON DELETE SET NULL,
  purchase_number         VARCHAR(50),
  client_purchase_id      UUID,
  status                  document_status NOT NULL DEFAULT 'confirmed',
  payment_mode            payment_mode,
  subtotal_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  returned_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_gst_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  supplier_name_snapshot  TEXT,
  product_summary         TEXT,
  product_count           INT NOT NULL DEFAULT 0,
  notes                   TEXT,
  purchase_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT chk_purchases_amounts CHECK (
    subtotal_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_client_purchase_id
  ON purchases (client_purchase_id) WHERE client_purchase_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_store_date
  ON purchases (store_id, purchase_date DESC) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_purchases_supplier_date
  ON purchases (supplier_id, purchase_date DESC) WHERE is_deleted = FALSE;

-- ---------------------------------------------------------------------------
-- PURCHASE ITEMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_items (
  id                      BIGSERIAL PRIMARY KEY,
  purchase_id             BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id              BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_id                UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
  line_no                 INT NOT NULL,
  quantity                NUMERIC(12,3) NOT NULL,
  unit_cost               NUMERIC(12,2) NOT NULL,
  discount_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_percent             NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total              NUMERIC(14,2) NOT NULL,
  expiry_date             DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_purchase_items_purchase_line UNIQUE (purchase_id, line_no),
  CONSTRAINT chk_purchase_items_qty CHECK (quantity > 0),
  CONSTRAINT chk_purchase_items_amounts CHECK (unit_cost >= 0 AND line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items (product_id, created_at DESC);

-- FK from inventory_batches.purchase_id (deferred until purchases exists)
ALTER TABLE inventory_batches
  DROP CONSTRAINT IF EXISTS inventory_batches_purchase_id_fkey;
ALTER TABLE inventory_batches
  ADD CONSTRAINT inventory_batches_purchase_id_fkey
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- PAYMENTS (unified: sales, purchases, expenses, ledger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  client_payment_id   UUID,
  direction           payment_direction NOT NULL,
  payment_mode        payment_mode NOT NULL,
  amount              NUMERIC(14,2) NOT NULL,
  party_type          party_type,
  party_id            BIGINT,
  sale_id             BIGINT REFERENCES sales(id) ON DELETE SET NULL,
  purchase_id         BIGINT REFERENCES purchases(id) ON DELETE SET NULL,
  expense_id          BIGINT,
  reference_type      VARCHAR(50),
  reference_id        BIGINT,
  notes               TEXT,
  payment_date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payments_amount CHECK (amount > 0),
  CONSTRAINT chk_payments_party_link CHECK (
    (sale_id IS NOT NULL)::INT +
    (purchase_id IS NOT NULL)::INT +
    (expense_id IS NOT NULL)::INT <= 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_client_payment_id
  ON payments (client_payment_id) WHERE client_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_store_date
  ON payments (store_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_party
  ON payments (party_type, party_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_purchase ON payments (purchase_id) WHERE purchase_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- EXPENSES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  category            VARCHAR(100) NOT NULL,
  expense_type        VARCHAR(50) NOT NULL DEFAULT 'general',
  staff_id            BIGINT,
  amount              NUMERIC(14,2) NOT NULL,
  payment_mode        payment_mode NOT NULL DEFAULT 'cash',
  description         TEXT,
  expense_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by          INT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT chk_expenses_amount CHECK (amount > 0)
);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_expense_id_fkey;
ALTER TABLE payments
  ADD CONSTRAINT payments_expense_id_fkey
  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_store_date
  ON expenses (store_id, expense_date DESC) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_expenses_category_date
  ON expenses (category, expense_date DESC) WHERE is_deleted = FALSE;

-- ---------------------------------------------------------------------------
-- SETTINGS (scoped key-value)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id              BIGSERIAL PRIMARY KEY,
  store_id        UUID REFERENCES stores(id) ON DELETE CASCADE,
  scope           VARCHAR(20) NOT NULL DEFAULT 'tenant'
                  CHECK (scope IN ('tenant', 'store', 'user')),
  key             VARCHAR(100) NOT NULL,
  value_json      JSONB NOT NULL DEFAULT '{}',
  updated_by      INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_settings_scope_key UNIQUE (store_id, scope, key)
);

CREATE INDEX IF NOT EXISTS idx_settings_key ON settings (key);
CREATE INDEX IF NOT EXISTS idx_settings_value_gin ON settings USING GIN (value_json);

-- ---------------------------------------------------------------------------
-- AUDIT LOGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  store_id        UUID REFERENCES stores(id) ON DELETE SET NULL,
  user_id         INT REFERENCES users(id) ON DELETE SET NULL,
  action          audit_action NOT NULL,
  entity_type     VARCHAR(50) NOT NULL,
  entity_id       TEXT,
  old_values      JSONB,
  new_values      JSONB,
  ip_address      INET,
  user_agent      TEXT,
  request_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_time
  ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time
  ON audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_store_time
  ON audit_logs (store_id, created_at DESC);

-- Partitioning recommendation (apply in production when volume grows):
-- CREATE TABLE audit_logs_YYYY_MM PARTITION OF audit_logs FOR VALUES FROM (...) TO (...);

-- ---------------------------------------------------------------------------
-- SEED: system roles
-- ---------------------------------------------------------------------------
INSERT INTO roles (code, name, description, is_system) VALUES
  ('owner', 'Owner', 'Full tenant access', TRUE),
  ('admin', 'Admin', 'Store administration', TRUE),
  ('cashier', 'Cashier', 'POS billing only', TRUE),
  ('inventory_manager', 'Inventory Manager', 'Stock and purchases', TRUE),
  ('accountant', 'Accountant', 'Payments and reports', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores', 'users', 'categories', 'products', 'inventory_batches',
    'customers', 'suppliers', 'sales', 'purchases', 'expenses', 'settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
