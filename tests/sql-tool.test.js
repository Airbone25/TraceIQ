import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  default: {
    MAX_QUERY_ROWS: 500,
    MAX_AGENT_STEPS: 8,
    MAX_SQL_QUERIES: 5,
    MAX_EXECUTION_TIME_MS: 30000,
    MAX_QUERY_TIMEOUT_MS: 30000,
  },
}));

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

import { sqlTool } from '../tools/sql.tool.js';

const execContext = { exec: { query: mockQuery } };

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
    mockQuery.mockResolvedValue(mockRows);

    const result = await sqlTool.execute({ sql: 'SELECT * FROM orders' }, execContext);

    expect(result.success).toBe(true);
    expect(result.rows).toEqual(mockRows);
    expect(result.rowCount).toBe(1);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should append LIMIT when query has no LIMIT', async () => {
    mockQuery.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT * FROM orders' }, execContext);

    const calledSql = mockQuery.mock.calls[0][0];
    expect(calledSql).toMatch(/LIMIT\s+500$/i);
  });

  it('should not append LIMIT when query already has LIMIT', async () => {
    mockQuery.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT * FROM orders LIMIT 10' }, execContext);

    const calledSql = mockQuery.mock.calls[0][0];
    expect(calledSql).toBe('SELECT * FROM orders LIMIT 10');
  });

  it('should strip trailing semicolon and append LIMIT when no LIMIT', async () => {
    mockQuery.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT * FROM orders;' }, execContext);

    const calledSql = mockQuery.mock.calls[0][0];
    expect(calledSql).toBe('SELECT * FROM orders LIMIT 500');
  });

  it('should strip trailing semicolon and preserve existing LIMIT', async () => {
    mockQuery.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT * FROM orders LIMIT 10;' }, execContext);

    const calledSql = mockQuery.mock.calls[0][0];
    expect(calledSql).toBe('SELECT * FROM orders LIMIT 10');
  });

  it('should reject non-SELECT queries', async () => {
    const result = await sqlTool.execute({ sql: 'INSERT INTO orders VALUES (1)' }, execContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('validation failed');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should reject DROP queries', async () => {
    const result = await sqlTool.execute({ sql: 'DROP TABLE orders' }, execContext);

    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should reject DELETE queries', async () => {
    const result = await sqlTool.execute({ sql: 'DELETE FROM orders WHERE id = 1' }, execContext);

    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should reject UPDATE queries', async () => {
    const result = await sqlTool.execute({ sql: 'UPDATE orders SET x = 1' }, execContext);

    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should reject queries with SLEEP()', async () => {
    const result = await sqlTool.execute({ sql: 'SELECT SLEEP(5)' }, execContext);

    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should reject multi-statement queries', async () => {
    const result = await sqlTool.execute({ sql: 'SELECT 1; DROP TABLE orders' }, execContext);

    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should reject empty SQL', async () => {
    const result = await sqlTool.execute({ sql: '' }, execContext);

    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should reject null SQL', async () => {
    const result = await sqlTool.execute({ sql: null }, execContext);

    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValue(new Error('Table not found'));

    const result = await sqlTool.execute({ sql: 'SELECT * FROM nonexistent' }, execContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Table not found');
  });

  it('should pass params to query', async () => {
    mockQuery.mockResolvedValue([]);

    await sqlTool.execute({
      sql: 'SELECT * FROM orders WHERE id > ?',
      params: [10],
    }, execContext);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [10],
    );
  });

  it('should default params to empty array', async () => {
    mockQuery.mockResolvedValue([]);

    await sqlTool.execute({ sql: 'SELECT 1' }, execContext);

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), []);
  });

  it('should mark truncated when rows.length >= MAX_QUERY_ROWS', async () => {
    const manyRows = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    mockQuery.mockResolvedValue(manyRows);

    const result = await sqlTool.execute({ sql: 'SELECT * FROM orders LIMIT 500' }, execContext);

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(500);
  });

  it('should not mark truncated when rows.length < MAX_QUERY_ROWS', async () => {
    mockQuery.mockResolvedValue([{ id: 1 }]);

    const result = await sqlTool.execute({ sql: 'SELECT * FROM orders LIMIT 10' }, execContext);

    expect(result.truncated).toBe(false);
  });

  it('should accept SHOW queries', async () => {
    mockQuery.mockResolvedValue([{ Tables_in_traceiq: 'orders' }]);

    const result = await sqlTool.execute({ sql: 'SHOW TABLES' }, execContext);

    expect(result.success).toBe(true);
  });

  it('should accept DESCRIBE queries', async () => {
    mockQuery.mockResolvedValue([{ Field: 'id', Type: 'int' }]);

    const result = await sqlTool.execute({ sql: 'DESCRIBE orders' }, execContext);

    expect(result.success).toBe(true);
  });

  it('should accept EXPLAIN queries', async () => {
    mockQuery.mockResolvedValue([{ id: 1, select_type: 'SIMPLE' }]);

    const result = await sqlTool.execute({ sql: 'EXPLAIN SELECT * FROM orders' }, execContext);

    expect(result.success).toBe(true);
  });

  it('should include the failed query in error response', async () => {
    const result = await sqlTool.execute({ sql: 'UPDATE orders SET x = 1' }, execContext);

    expect(result.success).toBe(false);
    expect(result.query).toBe('UPDATE orders SET x = 1');
  });

  it('should reject execution when no target database is bound', async () => {
    const result = await sqlTool.execute({ sql: 'SELECT 1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No target database is bound');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
