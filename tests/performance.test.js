import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChatCompletion, mockRegistryExecute, mockOverviewExecute, mockCreateInvestigation, mockAddStep, mockFinalizeInvestigation } = vi.hoisted(() => ({
  mockChatCompletion: vi.fn(),
  mockRegistryExecute: vi.fn(),
  mockCreateInvestigation: vi.fn().mockResolvedValue({ id: 'test-inv-id', startedAt: new Date() }),
  mockAddStep: vi.fn().mockResolvedValue(undefined),
  mockFinalizeInvestigation: vi.fn().mockResolvedValue(undefined),
    mockOverviewExecute: vi.fn(),
}));

vi.mock('../llm/groq.js', () => ({
  chatCompletion: mockChatCompletion,
}));

vi.mock('../database/investigation-store.js', () => ({
  createInvestigation: mockCreateInvestigation,
  addStep: mockAddStep,
  finalizeInvestigation: mockFinalizeInvestigation,
}));

vi.mock('../tools/registry.js', () => ({
  ToolRegistry: class {
    constructor() { this.tools = new Map(); }
    register(tool) { this.tools.set(tool.name, tool); }
    get(name) { return this.tools.get(name); }
    getAll() { return Array.from(this.tools.values()); }
    getDefinitions() {
      return this.getAll().map(t => ({
        name: t.name, description: t.description, parameters: t.parameters,
      }));
    }
    async execute(name, input) { return mockRegistryExecute(name, input); }
  },
}));

vi.mock('../tools/schema.tool.js', () => ({
  schemaTool: { name: 'get_schema', description: 'mock', parameters: {}, execute: vi.fn() },
}));

vi.mock('../tools/sql.tool.js', () => ({
  sqlTool: { name: 'execute_sql', description: 'mock', parameters: {}, execute: vi.fn() },
}));

vi.mock('../tools/overview.tool.js', () => ({
  overviewTool: { name: 'get_overview', description: 'mock', parameters: {}, schema: {}, execute: mockOverviewExecute },
}));

vi.mock('../config/env.js', () => ({
  default: {
    MAX_AGENT_STEPS: 8,
    MAX_SQL_QUERIES: 5,
    MAX_QUERY_ROWS: 500,
    MAX_EXECUTION_TIME_MS: 60000,
    MAX_QUERY_TIMEOUT_MS: 30000,
  },
}));

vi.mock('../agent/prompts.js', () => ({
  buildSystemPrompt: () => 'You are a test agent.',
  buildStallMessage: (n) => `System note: Stall nudge after ${n} non-SQL calls.`,
}));

import { runInvestigation } from '../agent/agent.js';
import { validateSql } from '../security/sql-validator.js';

function toolCall(id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

describe('Performance Tests', () => {
  beforeEach(() => {
    mockChatCompletion.mockReset();
    mockRegistryExecute.mockReset();
    mockRegistryExecute.mockResolvedValue({ success: true, data: 'mock_result' });
    mockOverviewExecute.mockReset();
    mockOverviewExecute.mockRejectedValue(new Error('no overview in test'));
  });

  describe('SQL LIMIT rewriting', () => {
    it('should correctly rewrite LIMIT above max', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 10000', { maxRows: 500 });
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 500');
    });

    it('should handle trailing semicolon with LIMIT', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 10000;', { maxRows: 500 });
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 500');
    });

    it('should handle trailing semicolon without LIMIT', () => {
      const result = validateSql('SELECT * FROM orders;', { maxRows: 500 });
      expect(result.sanitized).toBe('SELECT * FROM orders');
    });

    it('should preserve LIMIT at exact max with semicolon', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 500;', { maxRows: 500 });
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 500');
    });
  });

  describe('MAX_AGENT_STEPS enforcement', () => {
    it('should stop exactly at MAX_AGENT_STEPS', async () => {
      mockChatCompletion.mockResolvedValue({
        message: {
          content: null,
          tool_calls: [toolCall('c1', 'get_overview', { stat: 'row_counts' })],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 10,
      });

      const result = await runInvestigation('Keep going');
      expect(result.steps).toBe(8);
      expect(result.toolCalls).toHaveLength(8);
      expect(mockChatCompletion).toHaveBeenCalledTimes(9);
    });
  });

  describe('MAX_SQL_QUERIES enforcement', () => {
    it('should stop exactly at MAX_SQL_QUERIES', async () => {
      let counter = 0;
      mockChatCompletion.mockImplementation(() => {
        counter++;
        return Promise.resolve({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'execute_sql', { sql: `SELECT ${counter}` })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 10,
        });
      });

      const result = await runInvestigation('Run SQL');
      expect(result.sqlQueries).toBe(5);
      expect(mockRegistryExecute).toHaveBeenCalledTimes(5);
    });

    it('should skip SQL after limit and report to LLM', async () => {
      let counter = 0;
      mockChatCompletion.mockImplementation(() => {
        counter++;
        if (counter <= 6) {
          return Promise.resolve({
            message: {
              content: null,
              tool_calls: [toolCall(`c${counter}`, 'execute_sql', { sql: `SELECT ${counter}` })],
            },
            finishReason: 'tool_calls',
            usage: {},
            duration: 10,
          });
        }
        return Promise.resolve({
          message: { content: 'Done after SQL limit.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 10,
        });
      });

      const result = await runInvestigation('Run many queries');
      expect(result.sqlQueries).toBe(5);
      expect(mockRegistryExecute).toHaveBeenCalledTimes(5);
    });
  });

  describe('Execution timeout', () => {
    it('should stop at MAX_EXECUTION_TIME_MS', async () => {
      const originalDateNow = Date.now;
      let mockTime = 0;
      Date.now = () => mockTime;

      mockChatCompletion.mockImplementation(() => {
        mockTime += 10000;
        return Promise.resolve({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'execute_sql', { sql: 'SELECT 1' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 10,
        });
      });

      const result = await runInvestigation('Timeout test');
      Date.now = originalDateNow;
      expect(result.status).toBe('completed');
      expect(result.answer).toContain('step/timeout limit');
    });
  });

  describe('LLM call count measurement', () => {
    it('should track LLM call count', async () => {
      mockChatCompletion
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'get_schema', {})],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 50,
        })
        .mockResolvedValueOnce({
          message: { content: 'Done.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 30,
        });

      const result = await runInvestigation('Simple question');
      expect(result.llmCalls).toBe(2);
      expect(result.llmCallDetails).toHaveLength(2);
      expect(result.llmCallDetails[0].duration).toBe(50);
      expect(result.llmCallDetails[1].duration).toBe(30);
    });

    it('should report 0 LLM calls when answer comes without tools', async () => {
      mockChatCompletion.mockResolvedValue({
        message: { content: 'Direct answer.', tool_calls: null },
        finishReason: 'stop',
        usage: {},
        duration: 100,
      });

      const result = await runInvestigation('Quick question');
      expect(result.llmCalls).toBe(1);
      expect(result.llmDuration).toBe(100);
    });
  });

  describe('Batched tool calls', () => {
    it('should execute multiple tool calls from one LLM response without intermediate LLM', async () => {
      mockChatCompletion
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [
              toolCall('c1', 'get_schema', {}),
              toolCall('c2', 'get_overview', { stat: 'row_counts' }),
              toolCall('c3', 'execute_sql', { sql: 'SELECT 1' }),
            ],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: { content: 'Analysis complete.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 50,
        });

      const result = await runInvestigation('Batched tools');

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      expect(result.steps).toBe(3);
      expect(result.toolCalls).toHaveLength(3);
      expect(result.toolCalls[0].toolName).toBe('get_schema');
      expect(result.toolCalls[1].toolName).toBe('get_overview');
      expect(result.toolCalls[2].toolName).toBe('execute_sql');
    });

    it('should not require LLM call between independent tools', async () => {
      const llmCallOrder = [];
      mockChatCompletion.mockImplementation(() => {
        llmCallOrder.push(Date.now());
        if (llmCallOrder.length === 1) {
          return Promise.resolve({
            message: {
              content: null,
              tool_calls: [
                toolCall('c1', 'get_schema', {}),
                toolCall('c2', 'get_overview', { stat: 'row_counts' }),
              ],
            },
            finishReason: 'tool_calls',
            usage: {},
            duration: 100,
          });
        }
        return Promise.resolve({
          message: { content: 'Done.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 50,
        });
      });

      const result = await runInvestigation('Independent tools');
      expect(result.llmCalls).toBe(2);
      expect(result.toolCalls).toHaveLength(2);
    });
  });

  describe('Duplicate SQL protection', () => {
    it('should not re-execute duplicate SQL queries', async () => {
      mockChatCompletion
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'execute_sql', { sql: 'SELECT COUNT(*) FROM orders' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c2', 'execute_sql', { sql: 'SELECT COUNT(*) FROM orders' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: { content: 'Done.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 100,
        });

      mockRegistryExecute.mockResolvedValue({ success: true, rowCount: 100 });

      const result = await runInvestigation('Count orders');

      expect(result.sqlQueries).toBe(1);
      expect(mockRegistryExecute).toHaveBeenCalledTimes(1);
    });

    it('should allow normalized-different queries through', async () => {
      mockChatCompletion
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'execute_sql', { sql: 'SELECT COUNT(*) FROM orders' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c2', 'execute_sql', { sql: 'SELECT COUNT(*) FROM payments' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: { content: 'Done.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 100,
        });

      mockRegistryExecute.mockResolvedValue({ success: true, rowCount: 50 });

      const result = await runInvestigation('Count different tables');

      expect(result.sqlQueries).toBe(2);
      expect(mockRegistryExecute).toHaveBeenCalledTimes(2);
    });

    it('should handle whitespace normalization in duplicate detection', async () => {
      mockChatCompletion
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'execute_sql', { sql: 'SELECT  COUNT(*)  FROM  orders' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c2', 'execute_sql', { sql: 'SELECT COUNT(*) FROM orders' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: { content: 'Done.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 100,
        });

      mockRegistryExecute.mockResolvedValue({ success: true, rowCount: 100 });

      const result = await runInvestigation('Duplicate with different spacing');

      expect(result.sqlQueries).toBe(1);
      expect(mockRegistryExecute).toHaveBeenCalledTimes(1);
    });

    it('should return deduplication notice to LLM for duplicate queries', async () => {
      mockChatCompletion
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'execute_sql', { sql: 'SELECT 1' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c2', 'execute_sql', { sql: 'SELECT 1' })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 100,
        })
        .mockResolvedValueOnce({
          message: { content: 'Done.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 100,
        });

      mockRegistryExecute.mockResolvedValue({ success: true, data: 1 });

      const result = await runInvestigation('Duplicate SQL');

      expect(result.toolCalls[1].outputSummary).toContain('deduplicated');
    });
  });

  describe('Timing data in results', () => {
    it('should include llmCalls, llmDuration, toolDuration in result', async () => {
      mockChatCompletion
        .mockResolvedValueOnce({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'get_schema', {})],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 75,
        })
        .mockResolvedValueOnce({
          message: { content: 'Done.', tool_calls: null },
          finishReason: 'stop',
          usage: {},
          duration: 25,
        });

      mockRegistryExecute.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ success: true }), 10);
        });
      });

      const result = await runInvestigation('Timing test');

      expect(result.llmCalls).toBe(2);
      expect(result.llmDuration).toBe(100);
      expect(result.toolDuration).toBeGreaterThanOrEqual(0);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
      expect(result.llmCallDetails).toHaveLength(2);
      expect(result.llmCallDetails[0]).toHaveProperty('duration');
      expect(result.llmCallDetails[0]).toHaveProperty('finishReason');
      expect(result.llmCallDetails[0]).toHaveProperty('toolCallCount');
    });

    it('should include totalDuration on completion', async () => {
      mockChatCompletion.mockResolvedValue({
        message: { content: 'Quick answer.', tool_calls: null },
        finishReason: 'stop',
        usage: {},
        duration: 10,
      });

      const result = await runInvestigation('Fast question');
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
      expect(typeof result.totalDuration).toBe('number');
    });
  });
});
