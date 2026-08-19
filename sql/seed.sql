-- TraceIQ Seed Data
-- Contains intentional anomalies for agent evaluation

-- Customers: 20 customers across countries, segments, and devices
INSERT INTO customers (name, email, country, segment, device_preference, created_at) VALUES
  ('Alice Johnson', 'alice@example.com', 'USA', 'enterprise', 'desktop', '2024-01-15 10:00:00'),
  ('Bob Smith', 'bob@example.com', 'USA', 'smb', 'mobile', '2024-02-01 11:30:00'),
  ('Carlos Garcia', 'carlos@example.com', 'Mexico', 'consumer', 'mobile', '2024-02-10 09:15:00'),
  ('Diana Lee', 'diana@example.com', 'USA', 'enterprise', 'desktop', '2024-03-05 14:00:00'),
  ('Erik Nilsson', 'erik@example.com', 'Sweden', 'smb', 'desktop', '2024-03-20 08:45:00'),
  ('Fatima Al-Hassan', 'fatima@example.com', 'UAE', 'enterprise', 'mobile', '2024-04-01 12:00:00'),
  ('George Chen', 'george@example.com', 'USA', 'consumer', 'tablet', '2024-04-15 16:30:00'),
  ('Hannah Mueller', 'hannah@example.com', 'Germany', 'smb', 'desktop', '2024-05-01 10:00:00'),
  ('Ivan Petrov', 'ivan@example.com', 'Russia', 'consumer', 'mobile', '2024-05-15 13:20:00'),
  ('Julia Kim', 'julia@example.com', 'USA', 'consumer', 'mobile', '2024-06-01 09:00:00'),
  ('Kenji Tanaka', 'kenji@example.com', 'Japan', 'enterprise', 'desktop', '2024-06-15 07:30:00'),
  ('Laura Silva', 'laura@example.com', 'Brazil', 'smb', 'mobile', '2024-07-01 11:00:00'),
  ('Mike O\'Brien', 'mike@example.com', 'USA', 'enterprise', 'desktop', '2024-07-15 14:45:00'),
  ('Nadia Kozlov', 'nadia@example.com', 'Russia', 'consumer', 'tablet', '2024-08-01 10:15:00'),
  ('Oscar Lopez', 'oscar@example.com', 'Mexico', 'smb', 'mobile', '2024-08-15 12:30:00'),
  ('Priya Sharma', 'priya@example.com', 'India', 'enterprise', 'desktop', '2024-09-01 08:00:00'),
  ('Quinn Davis', 'quinn@example.com', 'USA', 'consumer', 'mobile', '2024-09-15 15:00:00'),
  ('Rosa Martinez', 'rosa@example.com', 'Spain', 'smb', 'desktop', '2024-10-01 09:45:00'),
  ('Sam Wilson', 'sam@example.com', 'USA', 'enterprise', 'desktop', '2024-10-15 11:30:00'),
  ('Tina Wang', 'tina@example.com', 'China', 'consumer', 'mobile', '2024-11-01 10:00:00');

-- Products: 10 products across categories
INSERT INTO products (name, category, price, cost, active, created_at) VALUES
  ('Pro Suite Annual', 'software', 999.99, 100.00, 1, '2024-01-01 00:00:00'),
  ('Basic Plan Monthly', 'software', 29.99, 5.00, 1, '2024-01-01 00:00:00'),
  ('Enterprise License', 'software', 4999.99, 500.00, 1, '2024-01-01 00:00:00'),
  ('Ergonomic Keyboard', 'hardware', 149.99, 60.00, 1, '2024-02-01 00:00:00'),
  ('Wireless Mouse', 'hardware', 49.99, 15.00, 1, '2024-02-01 00:00:00'),
  ('USB-C Hub', 'hardware', 79.99, 25.00, 1, '2024-03-01 00:00:00'),
  ('Online Training Course', 'services', 199.99, 20.00, 1, '2024-04-01 00:00:00'),
  ('Premium Support', 'services', 599.99, 80.00, 1, '2024-04-01 00:00:00'),
  ('Legacy Adapter', 'hardware', 39.99, 10.00, 0, '2024-01-01 00:00:00'),
  ('Cloud Storage 1TB', 'services', 12.99, 2.00, 1, '2024-05-01 00:00:00');

-- Orders + Order Items + Payments
-- Last 30 days of data
-- ANOMALY 1: Orders from Russia (Ivan, Nadia) stop after day 22 (payment gateway blocked Russian transactions)
-- ANOMALY 2: Mobile users have a 40% payment failure rate in the last 10 days (checkout bug on mobile)
-- ANOMALY 3: Product 9 (Legacy Adapter) was deactivated 15 days ago but had a surge of returns
-- ANOMALY 4: Enterprise segment had a bulk cancellation 5 days ago (1 customer, 3 orders)
-- ANOMALY 5: USA consumer mobile orders dropped because of a failed A/B test on mobile checkout

-- Day 0-19: Normal operations (roughly 8-12 orders per day)
INSERT INTO orders (customer_id, status, total_amount, created_at) VALUES
  (1, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 29 DAY)),
  (2, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 29 DAY)),
  (3, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 29 DAY)),
  (5, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 29 DAY)),
  (7, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 29 DAY)),
  (10, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 29 DAY)),
  (1, 'completed', 199.99, DATE_SUB(NOW(), INTERVAL 28 DAY)),
  (4, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 28 DAY)),
  (6, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 28 DAY)),
  (9, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 28 DAY)),
  (11, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 27 DAY)),
  (2, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 27 DAY)),
  (13, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 27 DAY)),
  (14, 'completed', 199.99, DATE_SUB(NOW(), INTERVAL 27 DAY)),
  (3, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 26 DAY)),
  (8, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 26 DAY)),
  (15, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 26 DAY)),
  (9, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 26 DAY)),
  (16, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 25 DAY)),
  (5, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 25 DAY)),
  (17, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 25 DAY)),
  (1, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 25 DAY)),
  (12, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 24 DAY)),
  (18, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 24 DAY)),
  (7, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 24 DAY)),
  (10, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 24 DAY)),
  (19, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 23 DAY)),
  (4, 'completed', 199.99, DATE_SUB(NOW(), INTERVAL 23 DAY)),
  (20, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 23 DAY)),
  (11, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 23 DAY)),
  (6, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 22 DAY)),
  (2, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 22 DAY)),
  (9, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 22 DAY)),
  (14, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 22 DAY)),
  (13, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 22 DAY)),
  (3, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 21 DAY)),
  (15, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 21 DAY)),
  (16, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 21 DAY)),
  (8, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 21 DAY)),
  (17, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 21 DAY)),
  (19, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (1, 'completed', 199.99, DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (12, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (5, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (18, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (10, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (20, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (4, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (11, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 19 DAY)),
  (7, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 19 DAY));

-- Day 10-19 (continuation, normal)
INSERT INTO orders (customer_id, status, total_amount, created_at) VALUES
  (1, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 18 DAY)),
  (6, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 18 DAY)),
  (13, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 18 DAY)),
  (14, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 18 DAY)),
  (3, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 18 DAY)),
  (8, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 17 DAY)),
  (9, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 17 DAY)),
  (16, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 17 DAY)),
  (2, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 17 DAY)),
  (19, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 17 DAY)),
  (5, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 16 DAY)),
  (12, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 16 DAY)),
  (15, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 16 DAY)),
  (17, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 16 DAY)),
  (20, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 16 DAY)),
  (4, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 15 DAY)),
  (10, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 15 DAY)),
  (18, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 15 DAY)),
  (11, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 15 DAY)),
  (1, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 15 DAY)),
  (7, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 14 DAY)),
  (13, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 14 DAY)),
  (6, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 14 DAY)),
  (16, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 14 DAY)),
  (3, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 14 DAY)),
  (9, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 13 DAY)),
  (14, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 13 DAY)),
  (8, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 13 DAY)),
  (12, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 13 DAY)),
  (19, 'completed', 199.99, DATE_SUB(NOW(), INTERVAL 13 DAY)),
  (5, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 12 DAY)),
  (2, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 12 DAY)),
  (17, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 12 DAY)),
  (20, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 12 DAY)),
  (11, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 12 DAY)),
  (4, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 11 DAY)),
  (15, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 11 DAY)),
  (10, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 11 DAY)),
  (18, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 11 DAY)),
  (1, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 11 DAY)),
  (7, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 10 DAY)),
  (13, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 10 DAY)),
  (6, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 10 DAY)),
  (3, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 10 DAY)),
  (9, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 10 DAY)),
  (16, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 10 DAY));

-- Day 9-1: Problem period
-- ANOMALY 2 starts: Mobile payment failures spike
INSERT INTO orders (customer_id, status, total_amount, created_at) VALUES
  (2, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 9 DAY)),
  (8, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 9 DAY)),
  (12, 'pending', 999.99, DATE_SUB(NOW(), INTERVAL 9 DAY)),
  (14, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 9 DAY)),
  (19, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 9 DAY)),
  (4, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 8 DAY)),
  (5, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 8 DAY)),
  (17, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 8 DAY)),
  (20, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 8 DAY)),
  (15, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 8 DAY)),
  (1, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 7 DAY)),
  (6, 'completed', 199.99, DATE_SUB(NOW(), INTERVAL 7 DAY)),
  (11, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 7 DAY)),
  (13, 'cancelled', 999.99, DATE_SUB(NOW(), INTERVAL 7 DAY)),
  (18, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 7 DAY)),
  (7, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (10, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (16, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (2, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (14, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (3, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (8, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (12, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (15, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (19, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  -- ANOMALY 4: Enterprise bulk cancellation (customer 15 = Priya)
  (15, 'cancelled', 4999.99, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (15, 'cancelled', 4999.99, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (15, 'cancelled', 4999.99, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (1, 'completed', 99.99, DATE_SUB(NOW(), INTERVAL 4 DAY)),
  (5, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 4 DAY)),
  (11, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 4 DAY)),
  (17, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 4 DAY)),
  (20, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 4 DAY)),
  (4, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 3 DAY)),
  (7, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 3 DAY)),
  (13, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 3 DAY)),
  (18, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 3 DAY)),
  (6, 'completed', 39.99, DATE_SUB(NOW(), INTERVAL 3 DAY)),
  (2, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (10, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (14, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (16, 'completed', 4999.99, DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (19, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (1, 'completed', 149.99, DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (5, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (8, 'completed', 79.99, DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (11, 'completed', 599.99, DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (17, 'completed', 12.99, DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (3, 'completed', 999.99, DATE_SUB(NOW(), INTERVAL 0 DAY)),
  (6, 'completed', 49.99, DATE_SUB(NOW(), INTERVAL 0 DAY)),
  (14, 'completed', 29.99, DATE_SUB(NOW(), INTERVAL 0 DAY));

-- Order items: Map each order to 1-3 products
INSERT INTO order_items (order_id, product_id, quantity, unit_price, created_at)
SELECT
  o.id,
  CASE (o.id % 5)
    WHEN 0 THEN 1
    WHEN 1 THEN 2
    WHEN 2 THEN 5
    WHEN 3 THEN 4
    WHEN 4 THEN 8
  END,
  CASE (o.id % 3)
    WHEN 0 THEN 1
    WHEN 1 THEN 2
    WHEN 2 THEN 1
  END,
  CASE (o.id % 5)
    WHEN 0 THEN 999.99
    WHEN 1 THEN 29.99
    WHEN 2 THEN 49.99
    WHEN 3 THEN 149.99
    WHEN 4 THEN 599.99
  END,
  o.created_at
FROM orders o;

-- Some orders get a second item
INSERT INTO order_items (order_id, product_id, quantity, unit_price, created_at)
SELECT
  o.id,
  CASE (o.id % 4)
    WHEN 0 THEN 3
    WHEN 1 THEN 6
    WHEN 2 THEN 7
    WHEN 3 THEN 10
  END,
  1,
  CASE (o.id % 4)
    WHEN 0 THEN 4999.99
    WHEN 1 THEN 79.99
    WHEN 2 THEN 199.99
    WHEN 3 THEN 12.99
  END,
  o.created_at
FROM orders o
WHERE o.id % 3 = 0;

-- Payments: Most completed, some failures
-- ANOMALY 2: Mobile users (customers 2,3,7,9,10,12,14,17,20) have high failure rate in recent days
INSERT INTO payments (order_id, amount, method, status, failure_reason, created_at)
SELECT
  o.id,
  o.total_amount,
  CASE
    WHEN c.device_preference = 'mobile' THEN 'credit_card'
    WHEN c.device_preference = 'desktop' THEN 'credit_card'
    ELSE 'paypal'
  END,
  CASE
    -- ANOMALY 2: Mobile payment failures spike in last 10 days
    WHEN c.device_preference = 'mobile'
      AND DATEDIFF(NOW(), o.created_at) <= 10
      AND (o.id % 5 = 0 OR o.id % 7 = 0) THEN 'failed'
    -- Some normal failures scattered throughout
    WHEN o.id % 20 = 0 THEN 'failed'
    ELSE 'completed'
  END,
  CASE
    WHEN c.device_preference = 'mobile'
      AND DATEDIFF(NOW(), o.created_at) <= 10
      AND (o.id % 5 = 0 OR o.id % 7 = 0) THEN 'CARD_DECLINED_MOBILE_BUG'
    WHEN o.id % 20 = 0 THEN 'Insufficient funds'
    ELSE NULL
  END,
  o.created_at
FROM orders o
JOIN customers c ON o.customer_id = c.id;

-- ANOMALY 4 payments: Enterprise cancellations = refunded
UPDATE payments SET status = 'refunded', amount = 0.00
WHERE order_id IN (
  SELECT id FROM orders
  WHERE customer_id = 15
    AND status = 'cancelled'
    AND DATEDIFF(NOW(), created_at) <= 5
);
