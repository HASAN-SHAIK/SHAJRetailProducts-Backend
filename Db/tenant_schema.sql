CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role VARCHAR(50) CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS shop_details (
  id SERIAL PRIMARY KEY,
  shop_name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255),
  mobile_number VARCHAR(15),
  gst_number VARCHAR(20),
  address_line TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  mobile VARCHAR(15),
  location VARCHAR(100),
  address TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(255),
  is_weight_based BOOLEAN DEFAULT FALSE,
  selling_price DECIMAL(10,2) NOT NULL,
  actual_price DECIMAL(10,2),
  stock_quantity DECIMAL(10,2) NOT NULL,
  company VARCHAR(255),
  time_for_delivery INT,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT NULL,
  customer_id INT NULL,
  total_price DECIMAL(12,2),
  order_status VARCHAR(50) DEFAULT 'pending',
  transaction_type VARCHAR(10) DEFAULT 'sale' CHECK (transaction_type IN ('sale', 'purchase', 'personal')),
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  payment_mode VARCHAR(10) CHECK (payment_mode IN ('cash', 'online'))

);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT,
  product_id INT,
  quantity DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  order_id INT,
  total_price DECIMAL(12,2),
  profit DECIMAL(12,2),
  payment_mode VARCHAR(50),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_location ON customers(location);
