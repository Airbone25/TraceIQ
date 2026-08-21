import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockRawQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockRawQuery: vi.fn(),
}));

vi.mock('../database/mysql.js', () => ({
  query: mockQuery,
  rawQuery: mockRawQuery,
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

import { ToolRegistry } from '../tools/registry.js';
import { sqlTool } from '../tools/sql.tool.js';
import { overviewTool } from '../tools/overview.tool.js';

describe('Tool Input Validation', () => {
  let registry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ToolRegistry();
    registry.register(sqlTool);
    registry.register(overviewTool);
  });

  describe('execute_sql validation', () => {
    it('should accept valid arguments', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await registry.execute('execute_sql', { sql: 'SELECT 1' });
      expect(result.success).toBe(true);
    });

    it('should reject missing sql parameter', async () => {
      await expect(registry.execute('execute_sql', {})).rejects.toThrow('validation failed');
    });

    it('should reject null sql parameter', async () => {
      await expect(registry.execute('execute_sql', { sql: null })).rejects.toThrow('validation failed');
    });

    it('should reject non-string sql parameter', async () => {
      await expect(registry.execute('execute_sql', { sql: 123 })).rejects.toThrow('validation failed');
    });

    it('should accept extra arguments (zod strips or passes through)', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await registry.execute('execute_sql', { sql: 'SELECT 1', evil: true });
      expect(result.success).toBe(true);
    });

    it('should reject dangerous SQL at validation layer', async () => {
      const result = await registry.execute('execute_sql', { sql: 'DROP TABLE orders' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
    });

    it('should reject empty sql', async () => {
      const result = await registry.execute('execute_sql', { sql: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
    });
  });

  describe('get_overview validation', () => {
    it('should accept empty arguments and return tables with date ranges', async () => {
      mockRawQuery.mockResolvedValue([{ Tables_in_test: 'orders' }]);
      mockQuery.mockImplementation((sql) => {
        const s = String(sql);
        if (s.includes('INFORMATION_SCHEMA')) {
          return Promise.resolve([{ tableName: 'orders', columnName: 'created_at' }]);
        }
        if (s.includes('MIN(')) {
          return Promise.resolve([{ min_created_at: '2026-01-01', max_created_at: '2026-08-01' }]);
        }
        return Promise.resolve([{ count: 42 }]);
      });

      const result = await registry.execute('get_overview', {});

      expect(result.success).toBe(true);
      expect(result.tables).toEqual([{ name: 'orders', rowCount: 42 }]);
      expect(result.dateRanges).toEqual([
        { table: 'orders', column: 'created_at', min: '2026-01-01', max: '2026-08-01' },
      ]);
    });

    it('should reject unexpected parameters (strict schema)', async () => {
      await expect(registry.execute('get_overview', { stat: 'row_counts' })).rejects.toThrow('validation failed');
    });

    it('should return success:false instead of throwing when the database fails', async () => {
      mockRawQuery.mockRejectedValue(new Error('connection refused'));
      const result = await registry.execute('get_overview', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('connection refused');
    });
  });

  describe('Tool not found', () => {
    it('should throw for unknown tool', async () => {
      await expect(registry.execute('unknown_tool', {})).rejects.toThrow('Tool not found');
    });
  });
});
