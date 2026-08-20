import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../database/mysql.js', () => ({
  query: mockQuery,
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
import { statsTool } from '../tools/stats.tool.js';

describe('Tool Input Validation', () => {
  let registry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ToolRegistry();
    registry.register(sqlTool);
    registry.register(statsTool);
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

  describe('get_stats validation', () => {
    it('should accept valid stat parameter', async () => {
      const result = await registry.execute('get_stats', { stat: 'row_counts' });
      expect(result).toBeDefined();
    });

    it('should reject missing stat parameter', async () => {
      await expect(registry.execute('get_stats', {})).rejects.toThrow('validation failed');
    });

    it('should reject invalid stat value', async () => {
      await expect(registry.execute('get_stats', { stat: 'nonexistent_stat' })).rejects.toThrow('validation failed');
    });

    it('should reject non-string stat', async () => {
      await expect(registry.execute('get_stats', { stat: 123 })).rejects.toThrow('validation failed');
    });
  });

  describe('Tool not found', () => {
    it('should throw for unknown tool', async () => {
      await expect(registry.execute('unknown_tool', {})).rejects.toThrow('Tool not found');
    });
  });
});
