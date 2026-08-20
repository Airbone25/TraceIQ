import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../database/mysql.js', () => ({
  query: vi.fn(),
}));

vi.mock('../config/env.js', () => ({
  default: {
    MAX_QUERY_ROWS: 500,
    MAX_AGENT_STEPS: 8,
    MAX_SQL_QUERIES: 5,
    MAX_EXECUTION_TIME_MS: 30000,
    MAX_QUERY_TIMEOUT_MS: 30000,
  },
}));

import { sqlTool } from '../tools/sql.tool.js';
import { query } from '../database/mysql.js';
import { validateSql } from '../security/sql-validator.js';

describe('execute_sql Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct tool metadata', () => {
    expect(sqlTool.name).toBe('execute_sql');
    expect(sqlTool.description).toBeDefined();
    expect(sqlTool.parameters).toBeDefined();
    expect(sqlTool.execute).toBeInstanceOf(Function);
  });

  it('should execute valid SELECT query', async () => {
    const mockRows = [{ id: 1, name: 'test' }];
    query.mockResolvedValue(mockRows);

    const result = await sqlTool.execute({ sql: 'SELECT * FROM orders' });

    expect(result.success).toBe(true);
    expect(result.rows).toEqual(mockRows);
    expect(result.rowCount).toBe(1);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should append LIMIT when query has no LIMIT', async () => {
    query.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT * FROM orders' });

    const calledSql = query.mock.calls[0][0];
    expect(calledSql).toMatch(/LIMIT\s+500$/i);
  });

  it('should not append LIMIT when query already has LIMIT', async () => {
    query.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT * FROM orders LIMIT 10' });

    const calledSql = query.mock.calls[0][0];
    expect(calledSql).toBe('SELECT * FROM orders LIMIT 10');
  });

  it('should strip trailing semicolon and append LIMIT when no LIMIT', async () => {
    query.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT * FROM orders;' });

    const calledSql = query.mock.calls[0][0];
    expect(calledSql).toBe('SELECT * FROM orders LIMIT 500');
  });

  it('should strip trailing semicolon and preserve existing LIMIT', async () => {
    query.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT * FROM orders LIMIT 10;' });

    const calledSql = query.mock.calls[0][0];
    expect(calledSql).toBe('SELECT * FROM orders LIMIT 10');
  });

  it('should reject non-SELECT queries', async () => {
    const result = await sqlTool.execute({ sql: 'INSERT INTO orders VALUES (1)' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('validation failed');
    expect(query).not.toHaveBeenCalled();
  });

  it('should reject DROP queries', async () => {
    const result = await sqlTool.execute({ sql: 'DROP TABLE orders' });

    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('should reject DELETE queries', async () => {
    const result = await sqlTool.execute({ sql: 'DELETE FROM orders WHERE id = 1' });

    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('should reject UPDATE queries', async () => {
    const result = await sqlTool.execute({ sql: 'UPDATE orders SET status = "done"' });

    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('should reject queries with SLEEP()', async () => {
    const result = await sqlTool.execute({ sql: 'SELECT SLEEP(5)' });

    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('should reject multi-statement queries', async () => {
    const result = await sqlTool.execute({ sql: 'SELECT 1; DROP TABLE orders' });

    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('should reject empty SQL', async () => {
    const result = await sqlTool.execute({ sql: '' });

    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('should reject null SQL', async () => {
    const result = await sqlTool.execute({ sql: null });

    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    query.mockRejectedValue(new Error('Table not found'));

    const result = await sqlTool.execute({ sql: 'SELECT * FROM nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Table not found');
  });

  it('should pass params to query', async () => {
    query.mockResolvedValue([]);

    await sqlTool.execute({
      sql: 'SELECT * FROM orders WHERE id > ?',
      params: [10],
    });

    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      [10],
    );
  });

  it('should default params to empty array', async () => {
    query.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT 1' });

    expect(query).toHaveBeenCalledWith(expect.any(String), []);
  });

  it('should mark truncated when rows.length >= MAX_QUERY_ROWS', async () => {
    const manyRows = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    query.mockResolvedValue(manyRows);

    const result = await sqlTool.execute({ sql: 'SELECT * FROM orders LIMIT 500' });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(500);
  });

  it('should not mark truncated when rows.length < MAX_QUERY_ROWS', async () => {
    query.mockResolvedValue([{ id: 1 }]);

    const result = await sqlTool.execute({ sql: 'SELECT * FROM orders LIMIT 10' });

    expect(result.truncated).toBe(false);
  });

  it('should accept SHOW queries', async () => {
    query.mockResolvedValue([{ Tables_in_traceiq: 'orders' }]);

    const result = await sqlTool.execute({ sql: 'SHOW TABLES' });

    expect(result.success).toBe(true);
  });

  it('should accept DESCRIBE queries', async () => {
    query.mockResolvedValue([{ Field: 'id', Type: 'int' }]);

    const result = await sqlTool.execute({ sql: 'DESCRIBE orders' });

    expect(result.success).toBe(true);
  });

  it('should accept EXPLAIN queries', async () => {
    query.mockResolvedValue([{ id: 1, select_type: 'SIMPLE' }]);

    const result = await sqlTool.execute({ sql: 'EXPLAIN SELECT * FROM orders' });

    expect(result.success).toBe(true);
  });

  it('should include the failed query in error response', async () => {
    const result = await sqlTool.execute({ sql: 'UPDATE orders SET x = 1' });

    expect(result.success).toBe(false);
    expect(result.query).toBe('UPDATE orders SET x = 1');
  });
});
