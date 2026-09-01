-- Whybase Database Schema

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  country VARCHAR(100) NOT NULL,
  segment ENUM('enterprise', 'smb', 'consumer') NOT NULL DEFAULT 'consumer',
  device_preference ENUM('mobile', 'desktop', 'tablet') NOT NULL DEFAULT 'desktop',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_customers_country (country),
  INDEX idx_customers_segment (segment),
  INDEX idx_customers_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  cost DECIMAL(10, 2) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_products_category (category),
  INDEX idx_products_active (active)
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  status ENUM('completed', 'pending', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending',
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (customer_id) REFERENCES customers(id),
  INDEX idx_orders_customer_id (customer_id),
  INDEX idx_orders_status (status),
  INDEX idx_orders_created_at (created_at),
  INDEX idx_orders_status_created (status, created_at)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_order_items_order_id (order_id),
  INDEX idx_order_items_product_id (product_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  method ENUM('credit_card', 'debit_card', 'paypal', 'bank_transfer', 'crypto') NOT NULL,
  status ENUM('completed', 'failed', 'pending', 'refunded') NOT NULL DEFAULT 'pending',
  failure_reason VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_payments_order_id (order_id),
  INDEX idx_payments_status (status),
  INDEX idx_payments_created_at (created_at),
  INDEX idx_payments_method_status (method, status)
);

-- Investigation persistence tables
CREATE TABLE IF NOT EXISTS investigation_threads (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  user_id VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_investigation_threads_updated (updated_at),
  INDEX idx_investigation_threads_user (user_id)
);

CREATE TABLE IF NOT EXISTS investigations (
  id VARCHAR(36) PRIMARY KEY,
  thread_id VARCHAR(36) NULL,
  user_id VARCHAR(36) NULL,
  question TEXT NOT NULL,
  status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NULL,
  duration_ms INT UNSIGNED NULL,
  steps INT UNSIGNED DEFAULT 0,
  sql_queries INT UNSIGNED DEFAULT 0,
  final_answer TEXT NULL,
  error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_investigations_status (status),
  INDEX idx_investigations_created_at (created_at),
  INDEX idx_investigations_thread (thread_id)
);

CREATE TABLE IF NOT EXISTS investigation_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  thread_id VARCHAR(36) NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_investigation_messages_thread (thread_id, created_at)
);

CREATE TABLE IF NOT EXISTS investigation_steps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  investigation_id VARCHAR(36) NOT NULL,
  step_number INT UNSIGNED NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  tool_input JSON NULL,
  tool_output JSON NULL,
  duration_ms INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
  INDEX idx_investigation_steps_investigation_id (investigation_id)
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  groq_api_key VARCHAR(255) NULL,
  groq_model VARCHAR(120) NULL,
  groq_configured TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_users_email (email)
);

CREATE TABLE IF NOT EXISTS db_connections (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT UNSIGNED NOT NULL DEFAULT 3306,
  db_user VARCHAR(120) NOT NULL,
  password_enc TEXT NOT NULL,
  user_id VARCHAR(36) NULL,
  last_used_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_db_connections_name (name),
  INDEX idx_db_connections_user (user_id)
);
