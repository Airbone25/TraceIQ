import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('groq-sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

vi.mock('../config/env.js', () => ({
  default: {
    GROQ_API_KEY: 'test-api-key',
    GROQ_MODEL: 'openai/gpt-oss-120b',
  },
}));

import { chatCompletion } from '../llm/groq.js';
import Groq from 'groq-sdk';

describe('Groq Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call chat.completions.create with correct params', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const messages = [{ role: 'user', content: 'Hi' }];
    const tools = [{ name: 'test', description: 'A test', parameters: {} }];

    await chatCompletion({ messages, tools });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const params = mockCreate.mock.calls[0][0];
    expect(params.model).toBe('openai/gpt-oss-120b');
    expect(params.messages).toBe(messages);
    expect(params.temperature).toBe(0.1);
    expect(params.max_tokens).toBe(4096);
    expect(params.tool_choice).toBe('auto');
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0].type).toBe('function');
    expect(params.tools[0].function.name).toBe('test');
  });

  it('should return message and finish reason', async () => {
    const message = { content: 'Answer', tool_calls: null };
    mockCreate.mockResolvedValue({
      choices: [{ message, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const result = await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

    expect(result.message).toBe(message);
    expect(result.finishReason).toBe('stop');
  });

  it('should return usage stats', async () => {
    const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage,
    });

    const result = await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

    expect(result.usage).toEqual(usage);
  });

  it('should return duration in milliseconds', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    });

    const result = await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(typeof result.duration).toBe('number');
  });

  it('should transform tool definitions to Groq format', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    });

    const tools = [
      { name: 'get_schema', description: 'Get schema', parameters: { type: 'object', properties: {} } },
      { name: 'execute_sql', description: 'Run SQL', parameters: { type: 'object', properties: { sql: { type: 'string' } } } },
    ];

    await chatCompletion({ messages: [{ role: 'user', content: 'Q' }], tools });

    const params = mockCreate.mock.calls[0][0];
    expect(params.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_schema',
          description: 'Get schema',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'execute_sql',
          description: 'Run SQL',
          parameters: { type: 'object', properties: { sql: { type: 'string' } } },
        },
      },
    ]);
  });

  it('should not include tools param when tools array is empty', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    });

    await chatCompletion({ messages: [{ role: 'user', content: 'Q' }], tools: [] });

    const params = mockCreate.mock.calls[0][0];
    expect(params.tools).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
  });

  it('should not include tools param when tools is undefined', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    });

    await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

    const params = mockCreate.mock.calls[0][0];
    expect(params.tools).toBeUndefined();
  });

  it('should use custom temperature', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    });

    await chatCompletion({ messages: [{ role: 'user', content: 'Q' }], temperature: 0.5 });

    const params = mockCreate.mock.calls[0][0];
    expect(params.temperature).toBe(0.5);
  });

  it('should use API key from env config', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    });

    await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

    expect(mockCreate).toHaveBeenCalled();
  });

  it('should handle tool_calls in response', async () => {
    const message = {
      content: null,
      tool_calls: [
        {
          id: 'call_123',
          type: 'function',
          function: { name: 'execute_sql', arguments: '{"sql":"SELECT 1"}' },
        },
      ],
    };
    mockCreate.mockResolvedValue({
      choices: [{ message, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });

    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'Q' }],
      tools: [{ name: 'execute_sql', description: 'SQL', parameters: {} }],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.message.tool_calls).toHaveLength(1);
    expect(result.message.tool_calls[0].function.name).toBe('execute_sql');
  });

  describe('Retry logic', () => {
    it('should retry on 429 rate limit and succeed', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.status = 429;
      rateLimitError.headers = {};

      mockCreate
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: {},
        });

      const result = await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.message.content).toBe('ok');
      expect(result.error).toBeNull();
    });

    it('should retry on 500 server error and succeed', async () => {
      const serverError = new Error('Internal Server Error');
      serverError.status = 500;

      mockCreate
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: {},
        });

      const result = await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result.message.content).toBe('ok');
    });

    it('should not retry on 401 unauthorized', async () => {
      const authError = new Error('Unauthorized');
      authError.status = 401;

      mockCreate.mockRejectedValue(authError);

      await expect(
        chatCompletion({ messages: [{ role: 'user', content: 'Q' }] }),
      ).rejects.toThrow('Unauthorized');

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 403 forbidden', async () => {
      const forbiddenError = new Error('Forbidden');
      forbiddenError.status = 403;

      mockCreate.mockRejectedValue(forbiddenError);

      await expect(
        chatCompletion({ messages: [{ role: 'user', content: 'Q' }] }),
      ).rejects.toThrow('Forbidden');

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries exhausted', { timeout: 20000 }, async () => {
      const serverError = new Error('Server Error');
      serverError.status = 503;

      mockCreate.mockRejectedValue(serverError);

      await expect(
        chatCompletion({ messages: [{ role: 'user', content: 'Q' }] }),
      ).rejects.toThrow('Server Error');

      expect(mockCreate).toHaveBeenCalledTimes(4);
    });

    it('should retry on ECONNRESET network error', async () => {
      const networkError = new Error('Connection reset');
      networkError.code = 'ECONNRESET';

      mockCreate
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: {},
        });

      const result = await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.message.content).toBe('ok');
    });

    it('should not retry on non-retryable errors', async () => {
      const badRequestError = new Error('Bad Request');
      badRequestError.status = 400;

      mockCreate.mockRejectedValue(badRequestError);

      await expect(
        chatCompletion({ messages: [{ role: 'user', content: 'Q' }] }),
      ).rejects.toThrow('Bad Request');

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should use configurable model from env', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: {},
      });

      await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });

      const params = mockCreate.mock.calls[0][0];
      expect(params.model).toBe('openai/gpt-oss-120b');
    });

    it('should throw RateLimitError when retry delay exceeds cap', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.status = 429;
      rateLimitError.headers = { 'retry-after': '900' };

      mockCreate.mockRejectedValue(rateLimitError);

      const { RateLimitError } = await import('../llm/groq.js');
      await expect(
        chatCompletion({ messages: [{ role: 'user', content: 'Q' }] }),
      ).rejects.toThrow(RateLimitError);

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should include retryAfterMs in RateLimitError', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.status = 429;
      rateLimitError.headers = { 'retry-after': '120' };

      mockCreate.mockRejectedValue(rateLimitError);

      const { RateLimitError } = await import('../llm/groq.js');
      try {
        await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect(err.retryAfterMs).toBe(30000);
        expect(err.message).toContain('30 seconds');
      }
    });

    it('should cap retry delay to MAX_RETRY_DELAY_MS', async () => {
      const rateLimitError = new Error('Rate limit');
      rateLimitError.status = 429;
      rateLimitError.headers = { 'retry-after': '600' };

      mockCreate.mockRejectedValue(rateLimitError);

      const { RateLimitError } = await import('../llm/groq.js');
      try {
        await chatCompletion({ messages: [{ role: 'user', content: 'Q' }] });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.retryAfterMs).toBe(30000);
      }
    });
  });
});
