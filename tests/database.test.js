import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, testConnection, closePool, query } from '../database/mysql.js';

describe('Database', () => {
  it('should connect to MySQL', async () => {
    const connected = await testConnection();
    expect(connected).toBe(true);
  });

  it('should have the traceiq database', async () => {
    const [rows] = await getPool().execute('SELECT DATABASE() AS db');
    expect(rows[0].db).toBe('traceiq');
  });

  afterAll(async () => {
    await closePool();
  });
});
