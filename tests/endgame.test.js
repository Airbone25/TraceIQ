import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockChatCompletion, mockRegistryExecute, mockCreateInvestigation, mockAddStep, mockFinalizeInvestigation } = vi.hoisted(() => ({
  mockChatCompletion: vi.fn(),
  mockRegistryExecute: vi.fn(),
  mockCreateInvestigation: vi.fn().mockResolvedValue({ id: 'test-inv-id', startedAt: new Date() }),
  mockAddStep: vi.fn().mockResolvedValue(undefined),
  mockFinalizeInvestigation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../llm/groq.js', () => ({
  chatCompletion: mockChatCompletion,
  RateLimitError: class RateLimitError extends Error {},
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
      return this.getAll().map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
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
    MAX_AGENT_STEPS: 20,
    MAX_SQL_QUERIES: 5,
    MAX_QUERY_ROWS: 500,
    MAX_EXECUTION_TIME_MS: 30000,
    MAX_QUERY_TIMEOUT_MS: 30000,
    MAX_TOOL_RESULT_CHARS: 4000,
    MAX_CONTEXT_CHARS: 12000,
  },
}));

vi.mock('../agent/prompts.js', () => ({
  buildSystemPrompt: () => 'You are a test agent.',
  buildStallMessage: (n) => `System note: Stall nudge after ${n} non-SQL calls.`,
}));

import { runInvestigation } from '../agent/agent.js';
import { createAgentState, stepsRemaining, timeRemainingMs, shouldNudge, buildNudgeMessage } from '../agent/state.js';

function toolCall(id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

function toolCallsResponse(calls) {
  return {
    message: { content: null, tool_calls: calls },
    finishReason: 'tool_calls',
    usage: {},
    duration: 10,
  };
}

function stopResponse(content) {
  return {
    message: { content, tool_calls: null },
    finishReason: 'stop',
    usage: {},
    duration: 10,
  };
}

describe('Endgame Helpers (state.js)', () => {
  it('stepsRemaining should subtract current steps from max', () => {
    const state = createAgentState('q');
    state.steps = 18;
    expect(stepsRemaining(state)).toBe(2);
  });

  it('stepsRemaining should never go negative', () => {
    const state = createAgentState('q');
    state.steps = 25;
    expect(stepsRemaining(state)).toBe(0);
  });

  it('timeRemainingMs should reflect elapsed wall clock', () => {
    const originalNow = Date.now;
    Date.now = () => 1000;
    const state = createAgentState('q');
    Date.now = () => 6000;
    expect(timeRemainingMs(state)).toBe(25000);
    Date.now = originalNow;
  });

  it('shouldNudge should be false with ample budget', () => {
    const state = createAgentState('q');
    state.steps = 1;
    expect(shouldNudge(state)).toBe(false);
  });

  it('shouldNudge should trigger when steps are nearly exhausted', () => {
    const state = createAgentState('q');
    state.steps = 18;
    expect(shouldNudge(state)).toBe(true);
  });

  it('shouldNudge should trigger when time budget is 70% consumed', () => {
    const originalNow = Date.now;
    Date.now = () => 1000;
    const state = createAgentState('q');
    Date.now = () => 1000 + 30000 * 0.75;
    expect(shouldNudge(state)).toBe(true);
    Date.now = originalNow;
  });

  it('shouldNudge should not re-trigger once nudged', () => {
    const state = createAgentState('q');
    state.steps = 19;
    state.nudged = true;
    expect(shouldNudge(state)).toBe(false);
  });

  it('shouldNudge should ignore completed/failed states', () => {
    const state = createAgentState('q');
    state.steps = 19;
    state.status = 'completed';
    expect(shouldNudge(state)).toBe(false);
  });

  it('buildNudgeMessage should include remaining steps and seconds', () => {
    const originalNow = Date.now;
    Date.now = () => 1000;
    const state = createAgentState('q');
    state.steps = 18;
    const message = buildNudgeMessage(state);
    Date.now = originalNow;
    expect(message).toContain('2 step');
    expect(message).toMatch(/\d+ seconds/);
    expect(message).toContain('URGENT');
  });
});

describe('Endgame Agent Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateInvestigation.mockResolvedValue({ id: 'test-inv-id', startedAt: new Date() });
    mockAddStep.mockResolvedValue(undefined);
    mockFinalizeInvestigation.mockResolvedValue(undefined);
    mockChatCompletion.mockReset();
    mockRegistryExecute.mockReset();
    mockRegistryExecute.mockResolvedValue({ success: true, data: [{ value: 1 }] });
  });

  it('should inject exactly one endgame nudge when time budget runs low', async () => {
    const originalNow = Date.now;
    let mockTime = 0;
    Date.now = () => mockTime;

    let callCount = 0;
    const captured = [];
    mockChatCompletion.mockImplementation((params) => {
      callCount++;
      captured.push(params.messages.map(m => ({ ...m })));
      mockTime += 4000;
      return Promise.resolve(toolCallsResponse([
        toolCall(`c${callCount}`, 'get_stats', { stat: 'daily_orders', days: callCount }),
      ]));
    });

    try {
      await runInvestigation('Run until timeout');
    } finally {
      Date.now = originalNow;
    }

    const firstAppearance = captured.findIndex(messages =>
      messages.some(m => m.role === 'system' && String(m.content).includes('URGENT')));
    expect(firstAppearance).toBeGreaterThanOrEqual(5);

    const urgentInFinal = captured[captured.length - 1]
      .filter(m => m.role === 'system' && String(m.content).includes('URGENT'));
    expect(urgentInFinal).toHaveLength(1);
  });

  it('should force a final synthesis call without tools when limits exhaust', async () => {
    let callCount = 0;
    const captured = [];
    mockChatCompletion.mockImplementation((params) => {
      callCount++;
      captured.push(params);
      if (callCount <= 20) {
        return Promise.resolve(toolCallsResponse([
          toolCall(`c${callCount}`, 'get_stats', { stat: 'daily_orders', days: callCount }),
        ]));
      }
      return Promise.resolve(stopResponse('Synthesized conclusion.'));
    });

    const result = await runInvestigation('Exhaust all steps');

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('Synthesized conclusion.');
    expect(result.llmCalls).toBe(21);

    const synthesisCall = captured[captured.length - 1];
    expect(synthesisCall.tools).toBeUndefined();
    const lastMessage = synthesisCall.messages[synthesisCall.messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toContain('budget is exhausted');
  });

  it('should fall back to limit-reached message when synthesis fails', async () => {
    let callCount = 0;
    mockChatCompletion.mockImplementation(() => {
      callCount++;
      if (callCount <= 20) {
        return Promise.resolve(toolCallsResponse([
          toolCall(`c${callCount}`, 'get_stats', { stat: 'daily_orders', days: callCount }),
        ]));
      }
      return Promise.reject(new Error('synthesis service down'));
    });

    const result = await runInvestigation('Synthesis fails');

    expect(result.status).toBe('completed');
    expect(result.answer).toContain('step/timeout limit');
  });

  it('should not synthesize when the agent concludes naturally', async () => {
    mockChatCompletion
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c1', 'get_stats', { stat: 'row_counts' })]))
      .mockResolvedValueOnce(stopResponse('All done naturally.'));

    const result = await runInvestigation('Quick question');

    expect(result.answer).toBe('All done naturally.');
    expect(result.llmCalls).toBe(2);
    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('should serve repeated identical get_stats calls from cache', async () => {
    mockChatCompletion
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c1', 'get_stats', { stat: 'daily_orders', days: 7 })]))
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c2', 'get_stats', { stat: 'daily_orders', days: 7 })]))
      .mockResolvedValueOnce(stopResponse('done.'));

    const result = await runInvestigation('Cache check');

    expect(mockRegistryExecute).toHaveBeenCalledTimes(1);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[1].outputSummary).toContain('"cached":true');
  });

  it('should execute get_stats again for different inputs', async () => {
    mockChatCompletion
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c1', 'get_stats', { stat: 'daily_orders', days: 7 })]))
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c2', 'get_stats', { stat: 'daily_orders', days: 10 })]))
      .mockResolvedValueOnce(stopResponse('done.'));

    await runInvestigation('Distinct inputs');

    expect(mockRegistryExecute).toHaveBeenCalledTimes(2);
  });

  it('should scope the tool cache per investigation', async () => {
    mockChatCompletion
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c1', 'get_schema', {})]))
      .mockResolvedValueOnce(stopResponse('first done.'))
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c1', 'get_schema', {})]))
      .mockResolvedValueOnce(stopResponse('second done.'));

    await runInvestigation('First investigation');
    const result = await runInvestigation('Second investigation');

    expect(mockRegistryExecute).toHaveBeenCalledTimes(2);
    expect(result.answer).toBe('second done.');
  });

  it('should not cache failed tool results', async () => {
    mockRegistryExecute
      .mockResolvedValueOnce({ success: false, error: 'db exploded' })
      .mockResolvedValueOnce({ success: true, data: [{ ok: true }] });

    mockChatCompletion
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c1', 'get_stats', { stat: 'payment_failures', days: 3 })]))
      .mockResolvedValueOnce(toolCallsResponse([toolCall('c2', 'get_stats', { stat: 'payment_failures', days: 3 })]))
      .mockResolvedValueOnce(stopResponse('done.'));

    const result = await runInvestigation('Failed results not cached');

    expect(mockRegistryExecute).toHaveBeenCalledTimes(2);
    expect(result.toolCalls[0].outputSummary).toContain('db exploded');
    expect(result.toolCalls[1].outputSummary).toContain('"success":true');
    expect(result.toolCalls[1].outputSummary).not.toContain('"cached"');
  });
});
