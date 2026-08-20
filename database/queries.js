import { query, rawQuery } from './mysql.js';

export async function getSchemaInfo() {
  const tables = await rawQuery('SHOW TABLES');
  const tableNames = tables.map(row => Object.values(row)[0]);

  const schema = {};
  await Promise.all(tableNames.map(async (table) => {
    const [columns, indexes] = await Promise.all([
      rawQuery(`SHOW COLUMNS FROM \`${table}\``),
      rawQuery(`SHOW INDEX FROM \`${table}\``),
    ]);
    schema[table] = {
      columns: columns.map(c => ({
        name: c.Field,
        type: c.Type,
        nullable: c.Null === 'YES',
        key: c.Key,
        default: c.Default,
      })),
      indexes: indexes.map(i => ({
        name: i.Key_name,
        column: i.Column_name,
        unique: !i.Non_unique,
      })),
    };
  }));
  return schema;
}

export async function getTableRowCounts() {
  const tables = await rawQuery('SHOW TABLES');
  const tableNames = tables.map(row => Object.values(row)[0]);
  const counts = {};
  for (const table of tableNames) {
    const [row] = await query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    counts[table] = row.count;
  }
  return counts;
}

export async function getDailyOrderStats(days = 30) {
  return query(`
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS order_count,
      SUM(total_amount) AS total_revenue,
      COUNT(DISTINCT customer_id) AS unique_customers
    FROM orders
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE(created_at)
    ORDER BY date
  `, [days]);
}

export async function getPaymentFailureRate(days = 30) {
  return query(`
    SELECT
      DATE(p.created_at) AS date,
      COUNT(*) AS total_payments,
      SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) AS failed_payments,
      ROUND(SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS failure_rate
    FROM payments p
    WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE(p.created_at)
    ORDER BY date
  `, [days]);
}

export async function getOrdersBySegment(days = 30) {
  return query(`
    SELECT
      c.segment,
      DATE(o.created_at) AS date,
      COUNT(*) AS order_count,
      SUM(o.total_amount) AS revenue
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY c.segment, DATE(o.created_at)
    ORDER BY date, c.segment
  `, [days]);
}

export async function getOrdersByCountry(days = 30) {
  return query(`
    SELECT
      c.country,
      DATE(o.created_at) AS date,
      COUNT(*) AS order_count,
      SUM(o.total_amount) AS revenue
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY c.country, DATE(o.created_at)
    ORDER BY date, c.country
  `, [days]);
}

export async function getOrdersByDevice(days = 30) {
  return query(`
    SELECT
      c.device_preference,
      DATE(o.created_at) AS date,
      COUNT(*) AS order_count,
      SUM(o.total_amount) AS revenue
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY c.device_preference, DATE(o.created_at)
    ORDER BY date, c.device_preference
  `, [days]);
}

export async function getProductSalesBreakdown(days = 30) {
  return query(`
    SELECT
      p.name AS product_name,
      p.category,
      DATE(o.created_at) AS date,
      SUM(oi.quantity) AS units_sold,
      SUM(oi.quantity * oi.unit_price) AS revenue
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    JOIN orders o ON oi.order_id = o.id
    WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      AND o.status IN ('completed', 'pending')
    GROUP BY p.name, p.category, DATE(o.created_at)
    ORDER BY date, revenue DESC
  `, [days]);
}

export async function getPaymentMethodFailures(days = 30) {
  return query(`
    SELECT
      p.method,
      DATE(p.created_at) AS date,
      COUNT(*) AS total,
      SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) AS failures,
      ROUND(SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS failure_rate
    FROM payments p
    WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY p.method, DATE(p.created_at)
    ORDER BY date, p.method
  `, [days]);
}
