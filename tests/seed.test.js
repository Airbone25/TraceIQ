import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../database/mysql.js';
import { getTableRowCounts } from '../database/queries.js';

describe('Seed Data', () => {
  beforeAll(async () => {
    await getPool().getConnection();
  });

  it('should have 20 customers', async () => {
    const counts = await getTableRowCounts();
    expect(counts.customers).toBe(20);
  });

  it('should have 10 products', async () => {
    const counts = await getTableRowCounts();
    expect(counts.products).toBe(10);
  });

  it('should have orders across 30 days', async () => {
    const counts = await getTableRowCounts();
    expect(counts.orders).toBeGreaterThan(80);
  });

  it('should have order items for every order', async () => {
    const counts = await getTableRowCounts();
    expect(counts.order_items).toBeGreaterThanOrEqual(counts.orders);
  });

  it('should have payments for every order', async () => {
    const counts = await getTableRowCounts();
    expect(counts.payments).toBe(counts.orders);
  });

  it('should have cancelled orders (anomaly 4)', async () => {
    const [row] = await getPool().execute(
      "SELECT COUNT(*) AS cnt FROM orders WHERE status = 'cancelled'"
    );
    expect(row[0].cnt).toBeGreaterThan(0);
  });

  it('should have failed payments (anomaly 2)', async () => {
    const [row] = await getPool().execute(
      "SELECT COUNT(*) AS cnt FROM payments WHERE status = 'failed'"
    );
    expect(row[0].cnt).toBeGreaterThan(0);
  });

  it('should have an inactive product (anomaly 3)', async () => {
    const [row] = await getPool().execute(
      'SELECT COUNT(*) AS cnt FROM products WHERE active = 0'
    );
    expect(row[0].cnt).toBe(1);
  });

  afterAll(async () => {
    await closePool();
  });
});
