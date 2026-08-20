import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChatCompletion, mockRegistryExecute, mockCreateInvestigation, mockAddStep, mockFinalizeInvestigation } = vi.hoisted(() => ({
  mockChatCompletion: vi.fn(),
  mockRegistryExecute: vi.fn(),
  mockCreateInvestigation: vi.fn().mockResolvedValue({ id: 'test-inv-id', startedAt: new Date() }),
  mockAddStep: vi.fn().mockResolvedValue(undefined),
  mockFinalizeInvestigation: vi.fn().mockResolvedValue(undefined),
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
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    }
    async execute(name, input) {
      return mockRegistryExecute(name, input);
    }
  },
}));

vi.mock('../tools/schema.tool.js', () => ({
  schemaTool: { name: 'get_schema', description: 'mock', parameters: {}, execute: vi.fn() },
}));

vi.mock('../tools/sql.tool.js', () => ({
  sqlTool: { name: 'execute_sql', description: 'mock', parameters: {}, execute: vi.fn() },
}));

vi.mock('../tools/stats.tool.js', () => ({
  statsTool: { name: 'get_stats', description: 'mock', parameters: {}, execute: vi.fn() },
}));

vi.mock('../config/env.js', () => ({
  default: {
    MAX_AGENT_STEPS: 8,
    MAX_SQL_QUERIES: 5,
    MAX_QUERY_ROWS: 500,
    MAX_EXECUTION_TIME_MS: 30000,
    MAX_QUERY_TIMEOUT_MS: 30000,
  },
}));

vi.mock('../agent/prompts.js', () => ({
  buildSystemPrompt: () => 'You are a test agent.',
}));

import { runInvestigation } from '../agent/agent.js';

function toolCall(id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

function assistantMsg(content, toolCalls) {
  return { role: 'assistant', content, tool_calls: toolCalls };
}

function toolResultMsg(toolCallId, result) {
  return { role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result) };
}

describe('Agent Runtime', () => {
  beforeEach(() => {
    mockChatCompletion.mockReset();
    mockRegistryExecute.mockReset();
    mockRegistryExecute.mockResolvedValue({ success: true, data: 'mock_result' });
  });

  it('should complete investigation with final answer without tools', async () => {
    mockChatCompletion.mockResolvedValue({
      message: { content: 'Orders dropped due to seasonal factors.', tool_calls: null },
      finishReason: 'stop',
      usage: {},
      duration: 100,
    });

    const result = await runInvestigation('Why did orders drop?');

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('Orders dropped due to seasonal factors.');
    expect(result.steps).toBe(0);
    expect(result.sqlQueries).toBe(0);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('should handle final answer with empty tool_calls array', async () => {
    mockChatCompletion.mockResolvedValue({
      message: { content: 'The answer is 42.', tool_calls: [] },
      finishReason: 'stop',
      usage: {},
      duration: 100,
    });

    const result = await runInvestigation('What is the answer?');

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('The answer is 42.');
    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('should execute one tool call then get final answer', async () => {
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
        message: { content: 'There are 100 orders.', tool_calls: null },
        finishReason: 'stop',
        usage: {},
        duration: 100,
      });

    mockRegistryExecute.mockResolvedValue({ success: true, rowCount: 100 });

    const result = await runInvestigation('How many orders?');

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('There are 100 orders.');
    expect(result.steps).toBe(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('execute_sql');
    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    expect(mockRegistryExecute).toHaveBeenCalledWith('execute_sql', { sql: 'SELECT COUNT(*) FROM orders' });
  });

  it('should handle multiple sequential tool calls across iterations', async () => {
    mockChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [toolCall('c1', 'get_schema', {})],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 100,
      })
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [toolCall('c2', 'execute_sql', { sql: 'SELECT * FROM orders' })],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 100,
      })
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [toolCall('c3', 'get_stats', { stat: 'daily_orders' })],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 100,
      })
      .mockResolvedValueOnce({
        message: { content: 'Comprehensive analysis complete.', tool_calls: null },
        finishReason: 'stop',
        usage: {},
        duration: 100,
      });

    const result = await runInvestigation('Investigate everything');

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('Comprehensive analysis complete.');
    expect(result.steps).toBe(3);
    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolCalls[0].toolName).toBe('get_schema');
    expect(result.toolCalls[1].toolName).toBe('execute_sql');
    expect(result.toolCalls[2].toolName).toBe('get_stats');
    expect(mockChatCompletion).toHaveBeenCalledTimes(4);
  });

  it('should handle multiple tool calls in one iteration', async () => {
    mockChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [
            toolCall('c1', 'get_schema', {}),
            toolCall('c2', 'get_stats', { stat: 'row_counts' }),
          ],
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

    const result = await runInvestigation('Overview question');

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(2);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolName).toBe('get_schema');
    expect(result.toolCalls[1].toolName).toBe('get_stats');
    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('should stop at MAX_AGENT_STEPS', async () => {
    mockChatCompletion.mockResolvedValue({
      message: {
        content: null,
        tool_calls: [toolCall('c1', 'execute_sql', { sql: 'SELECT 1' })],
      },
      finishReason: 'tool_calls',
      usage: {},
      duration: 10,
    });

    const result = await runInvestigation('Keep going forever');

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(8);
    expect(result.answer).toContain('step/timeout limit');
    expect(result.toolCalls).toHaveLength(8);
    expect(mockChatCompletion).toHaveBeenCalledTimes(8);
  });

  it('should stop at MAX_SQL_QUERIES', async () => {
    mockChatCompletion.mockImplementation(() => {
      return Promise.resolve({
        message: {
          content: null,
          tool_calls: [toolCall('c1', 'execute_sql', { sql: `SELECT ${Math.random()}` })],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 10,
      });
    });

    const result = await runInvestigation('Run many SQL queries');

    expect(result.status).toBe('completed');
    expect(result.sqlQueries).toBe(5);
    expect(mockRegistryExecute).toHaveBeenCalledTimes(5);
    expect(result.answer).toContain('step/timeout limit');
  });

  it('should skip SQL execution when limit reached and report to LLM', async () => {
    let callCount = 0;
    mockChatCompletion.mockImplementation(() => {
      callCount++;
      if (callCount <= 6) {
        return Promise.resolve({
          message: {
            content: null,
            tool_calls: [toolCall(`c${callCount}`, 'execute_sql', { sql: `SELECT ${callCount}` })],
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

    expect(result.status).toBe('completed');
    expect(result.sqlQueries).toBe(5);
    expect(mockRegistryExecute).toHaveBeenCalledTimes(5);
  });

  it('should stop at MAX_EXECUTION_TIME_MS', async () => {
    const originalDateNow = Date.now;
    let mockTime = 0;
    Date.now = () => mockTime;

    mockChatCompletion.mockImplementation(() => {
      mockTime += 5000;
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

    const result = await runInvestigation('Run until timeout');

    Date.now = originalDateNow;
    expect(result.status).toBe('completed');
    expect(result.answer).toContain('step/timeout limit');
  });

  it('should handle tool execution failure gracefully', async () => {
    mockChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [toolCall('c1', 'execute_sql', { sql: 'SELECT bad_query' })],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 100,
      })
      .mockResolvedValueOnce({
        message: { content: 'The query failed, but I have enough info.', tool_calls: null },
        finishReason: 'stop',
        usage: {},
        duration: 100,
      });

    mockRegistryExecute.mockRejectedValue(new Error('Database connection lost'));

    const result = await runInvestigation('Investigate with failure');

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('The query failed, but I have enough info.');
    expect(result.steps).toBe(1);
    const toolCallRecord = result.toolCalls[0];
    expect(toolCallRecord.toolName).toBe('execute_sql');
  });

  it('should handle unknown tool name from LLM', async () => {
    mockChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [toolCall('c1', 'nonexistent_tool', { arg: 'value' })],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 100,
      })
      .mockResolvedValueOnce({
        message: { content: 'Okay, I will use a different tool.', tool_calls: null },
        finishReason: 'stop',
        usage: {},
        duration: 100,
      });

    mockRegistryExecute.mockRejectedValue(new Error('Tool not found: nonexistent_tool'));

    const result = await runInvestigation('Investigate with unknown tool');

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(1);
  });

  it('should handle malformed JSON in tool arguments', async () => {
    mockChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'execute_sql', arguments: '{invalid json!!' },
            },
          ],
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

    mockRegistryExecute.mockResolvedValue({ success: true });

    const result = await runInvestigation('Investigate with bad JSON');

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(1);
    expect(mockRegistryExecute).toHaveBeenCalledWith('execute_sql', {});
  });

  it('should handle empty Groq response (no choices)', async () => {
    mockChatCompletion.mockResolvedValue({
      message: undefined,
      finishReason: undefined,
      usage: {},
      duration: 100,
    });

    const result = await runInvestigation('Empty response question');

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('No answer generated.');
    expect(result.steps).toBe(0);
  });

  it('should handle Groq API failure', async () => {
    mockChatCompletion.mockRejectedValue(new Error('API key invalid'));

    const result = await runInvestigation('API failure question');

    expect(result.status).toBe('failed');
    expect(result.errors).toContain('API key invalid');
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('should set totalDuration on completion', async () => {
    mockChatCompletion.mockResolvedValue({
      message: { content: 'Quick answer.', tool_calls: null },
      finishReason: 'stop',
      usage: {},
      duration: 100,
    });

    const result = await runInvestigation('Fast question');

    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    expect(typeof result.totalDuration).toBe('number');
  });

  it('should return question in result', async () => {
    mockChatCompletion.mockResolvedValue({
      message: { content: 'Answer.', tool_calls: null },
      finishReason: 'stop',
      usage: {},
      duration: 100,
    });

    const result = await runInvestigation('What is the revenue?');

    expect(result.question).toBe('What is the revenue?');
  });

  it('should deduplicate repeated SQL queries', async () => {
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
        message: { content: 'Found 100 orders.', tool_calls: null },
        finishReason: 'stop',
        usage: {},
        duration: 100,
      });

    mockRegistryExecute.mockResolvedValue({ success: true, rowCount: 100 });

    const result = await runInvestigation('Count orders twice');

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(2);
    expect(result.sqlQueries).toBe(1);
    expect(mockRegistryExecute).toHaveBeenCalledTimes(1);
    expect(mockRegistryExecute).toHaveBeenCalledWith('execute_sql', { sql: 'SELECT COUNT(*) FROM orders' });
  });

  it('should track tool call durations', async () => {
    mockChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [toolCall('c1', 'get_schema', {})],
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

    const result = await runInvestigation('Schema question');

    expect(result.toolCalls[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('should record tool call input in state', async () => {
    const input = { sql: 'SELECT * FROM orders WHERE id > 10' };
    mockChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [toolCall('c1', 'execute_sql', input)],
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

    const result = await runInvestigation('Query with specific input');

    expect(result.toolCalls[0].input).toEqual(input);
  });

  it('should handle mixed tool calls across multiple steps', async () => {
    mockChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [toolCall('c1', 'get_schema', {})],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 100,
      })
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [
            toolCall('c2', 'execute_sql', { sql: 'SELECT * FROM orders' }),
            toolCall('c3', 'get_stats', { stat: 'daily_orders' }),
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
        duration: 100,
      });

    const result = await runInvestigation('Full investigation');

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(3);
    expect(result.toolCalls[0].toolName).toBe('get_schema');
    expect(result.toolCalls[1].toolName).toBe('execute_sql');
    expect(result.toolCalls[2].toolName).toBe('get_stats');
  });

  it('should return errors array (empty on success)', async () => {
    mockChatCompletion.mockResolvedValue({
      message: { content: 'Done.', tool_calls: null },
      finishReason: 'stop',
      usage: {},
      duration: 100,
    });

    const result = await runInvestigation('Simple question');

    expect(result.errors).toEqual([]);
  });

  it('should pass full message history to Groq on each call', async () => {
    const capturedCalls = [];
    mockChatCompletion.mockImplementation((params) => {
      capturedCalls.push({ messages: [...params.messages] });
      if (capturedCalls.length === 1) {
        return Promise.resolve({
          message: {
            content: null,
            tool_calls: [toolCall('c1', 'execute_sql', { sql: 'SELECT 1' })],
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
        duration: 100,
      });
    });

    await runInvestigation('Test message history');

    expect(capturedCalls).toHaveLength(2);
    const firstMessages = capturedCalls[0].messages;
    const secondMessages = capturedCalls[1].messages;
    expect(firstMessages.length).toBeGreaterThanOrEqual(2);
    expect(firstMessages[0].role).toBe('system');
    expect(firstMessages[1].role).toBe('user');
    expect(secondMessages.length).toBeGreaterThan(firstMessages.length);
    const lastMsg = secondMessages[secondMessages.length - 1];
    expect(lastMsg.role).toBe('tool');
  });

  it('should handle step limit stopping mid-iteration of multiple tool calls', async () => {
    mockChatCompletion.mockImplementation(() => {
      return Promise.resolve({
        message: {
          content: null,
          tool_calls: [
            toolCall('c1', 'execute_sql', { sql: 'SELECT 1' }),
            toolCall('c2', 'execute_sql', { sql: 'SELECT 2' }),
            toolCall('c3', 'execute_sql', { sql: 'SELECT 3' }),
          ],
        },
        finishReason: 'tool_calls',
        usage: {},
        duration: 10,
      });
    });

    const result = await runInvestigation('Many parallel tools');

    expect(result.status).toBe('completed');
    expect(result.steps).toBeLessThanOrEqual(8);
    expect(result.toolCalls.length).toBeLessThanOrEqual(8);
  });

  it('should NOT count skipped SQL calls toward sqlQueries counter (regression)', async () => {
    let callCount = 0;
    mockChatCompletion.mockImplementation(() => {
      callCount++;
      if (callCount <= 8) {
        return Promise.resolve({
          message: {
            content: null,
            tool_calls: [toolCall(`c${callCount}`, 'execute_sql', { sql: `SELECT ${callCount}` })],
          },
          finishReason: 'tool_calls',
          usage: {},
          duration: 10,
        });
      }
      return Promise.resolve({
        message: { content: 'Done.', tool_calls: null },
        finishReason: 'stop',
        usage: {},
        duration: 10,
      });
    });

    const result = await runInvestigation('SQL counter regression test');

    expect(result.steps).toBe(8);
    expect(mockRegistryExecute).toHaveBeenCalledTimes(5);
    expect(result.sqlQueries).toBe(5);
  });
});
