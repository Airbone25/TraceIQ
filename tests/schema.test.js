import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool, query } from '../database/mysql.js';
import { getSchemaInfo, getTableRowCounts } from '../database/queries.js';

describe('Schema', () => {
  beforeAll(async () => {
    await getPool().getConnection();
  });

  it('should have all required tables', async () => {
    const schema = await getSchemaInfo();
    const tables = Object.keys(schema);
    expect(tables).toContain('customers');
    expect(tables).toContain('orders');
    expect(tables).toContain('order_items');
    expect(tables).toContain('products');
    expect(tables).toContain('payments');
    expect(tables).toContain('investigation_threads');
    expect(tables).toContain('investigations');
    expect(tables).toContain('investigation_messages');
    expect(tables).toContain('investigation_steps');
    expect(tables.length).toBe(9);
  });

  it('should have correct columns on customers', async () => {
    const schema = await getSchemaInfo();
    const cols = schema.customers.columns.map(c => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('email');
    expect(cols).toContain('country');
    expect(cols).toContain('segment');
    expect(cols).toContain('device_preference');
    expect(cols).toContain('created_at');
  });

  it('should have correct columns on orders', async () => {
    const schema = await getSchemaInfo();
    const cols = schema.orders.columns.map(c => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('customer_id');
    expect(cols).toContain('status');
    expect(cols).toContain('total_amount');
    expect(cols).toContain('created_at');
  });

  it('should have foreign keys', async () => {
    const [fks] = await getPool().execute(`
      SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = 'traceiq' AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    expect(fks.length).toBeGreaterThanOrEqual(4);
  });

  afterAll(async () => {
    await closePool();
  });
});
