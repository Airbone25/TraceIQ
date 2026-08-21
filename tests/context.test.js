import { describe, it, expect } from 'vitest';
import { compressHistory, estimateSize } from '../agent/context.js';

function makeHistory(toolResultCount, resultChars = 500) {
  const messages = [
    { role: 'system', content: 'S'.repeat(200) },
    { role: 'user', content: 'U'.repeat(100) },
  ];
  for (let i = 0; i < toolResultCount; i++) {
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${i}`,
        type: 'function',
        function: {
          name: 'get_stats',
          arguments: JSON.stringify({ stat: 'daily_orders', days: i + 1 }),
        },
      }],
    });
    messages.push({
      role: 'tool',
      tool_call_id: `call_${i}`,
      content: JSON.stringify({ success: true, stat: 'daily_orders', rowCount: 10, data: 'D'.repeat(resultChars) }),
    });
  }
  return messages;
}

describe('Context Compression', () => {
  describe('estimateSize', () => {
    it('should sum content lengths across messages', () => {
      const messages = [
        { role: 'system', content: 'abc' },
        { role: 'user', content: 'de' },
      ];
      expect(estimateSize(messages)).toBeGreaterThan(5);
    });

    it('should include tool call arguments in size', () => {
      const withCalls = [{ role: 'assistant', content: null, tool_calls: [{ id: '1', function: { name: 'get_stats', arguments: '{"stat":"daily_orders"}' } }] }];
      const withoutCalls = [{ role: 'assistant', content: null }];
      expect(estimateSize(withCalls)).toBeGreaterThan(estimateSize(withoutCalls));
    });

    it('should return 0 for empty history', () => {
      expect(estimateSize([])).toBe(0);
    });
  });

  describe('compressHistory', () => {
    it('should return the same array when under budget', () => {
      const messages = makeHistory(3);
      const result = compressHistory(messages, { maxChars: 100000 });
      expect(result).toBe(messages);
    });

    it('should keep the most recent tool results full', () => {
      const messages = makeHistory(6);
      const result = compressHistory(messages, { maxChars: 1000, keepRecent: 2 });

      const toolMessages = result.filter(m => m.role === 'tool');
      const recent = JSON.parse(toolMessages[toolMessages.length - 1].content);
      expect(recent.success).toBe(true);
      expect(recent.compressed).toBeUndefined();
    });

    it('should replace older tool results with stubs', () => {
      const messages = makeHistory(6);
      const result = compressHistory(messages, { maxChars: 1000, keepRecent: 2 });

      const toolMessages = result.filter(m => m.role === 'tool');
      const oldest = JSON.parse(toolMessages[0].content);
      expect(oldest.compressed).toBe(true);
      expect(oldest.tool).toBe('get_stats');
      expect(oldest.input).toEqual({ stat: 'daily_orders', days: 1 });
      expect(typeof oldest.note).toBe('string');
    });

    it('should preserve message shape after compression', () => {
      const messages = makeHistory(5);
      const result = compressHistory(messages, { maxChars: 1000, keepRecent: 2 });

      expect(result).toHaveLength(messages.length);
      result.forEach((message, i) => {
        expect(message.role).toBe(messages[i].role);
        if (message.role === 'tool') {
          expect(message.tool_call_id).toBe(messages[i].tool_call_id);
        }
      });

      const assistantCallIds = result
        .filter(m => Array.isArray(m.tool_calls))
        .flatMap(m => m.tool_calls.map(c => c.id));
      const toolIds = result.filter(m => m.role === 'tool').map(m => m.tool_call_id);
      assistantCallIds.forEach(id => expect(toolIds).toContain(id));
    });

    it('should never alter system, user, or assistant messages', () => {
      const messages = makeHistory(4);
      const result = compressHistory(messages, { maxChars: 1000 });

      expect(result[0]).toEqual(messages[0]);
      expect(result[1]).toEqual(messages[1]);
      result.forEach((message, i) => {
        if (message.role === 'assistant') {
          expect(message).toEqual(messages[i]);
        }
      });
    });

    it('should handle multiple tool calls per assistant message', () => {
      const messages = [
        { role: 'system', content: 'S'.repeat(50) },
        { role: 'user', content: 'U' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'a', type: 'function', function: { name: 'get_schema', arguments: '{}' } },
            { id: 'b', type: 'function', function: { name: 'get_stats', arguments: '{"stat":"row_counts"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'a', content: JSON.stringify({ tables: ['orders'], data: 'X'.repeat(300) }) },
        { role: 'tool', tool_call_id: 'b', content: JSON.stringify({ stat: 'row_counts', data: 'Y'.repeat(300) }) },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c', type: 'function', function: { name: 'execute_sql', arguments: '{"sql":"SELECT 1"}' } }],
        },
        { role: 'tool', tool_call_id: 'c', content: JSON.stringify({ rows: [[1]] }) },
      ];

      const result = compressHistory(messages, { maxChars: 400, keepRecent: 1 });
      const toolMessages = result.filter(m => m.role === 'tool');

      const stubA = JSON.parse(toolMessages[0].content);
      expect(stubA.compressed).toBe(true);
      expect(stubA.tool).toBe('get_schema');

      const fullC = JSON.parse(toolMessages[2].content);
      expect(fullC.rows).toEqual([[1]]);
    });

    it('should include rowCount in the stub when parseable', () => {
      const messages = makeHistory(3);
      const result = compressHistory(messages, { maxChars: 500, keepRecent: 1 });
      const oldest = JSON.parse(result.filter(m => m.role === 'tool')[0].content);
      expect(oldest.rowCount).toBe(10);
    });

    it('should handle malformed tool call arguments without throwing', () => {
      const messages = [
        { role: 'user', content: 'U' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'x', type: 'function', function: { name: 'execute_sql', arguments: '{not json' } }],
        },
        { role: 'tool', tool_call_id: 'x', content: 'plain text output '.repeat(30) },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'y', type: 'function', function: { name: 'get_stats', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'y', content: '{"ok":true}' },
      ];

      const result = compressHistory(messages, { maxChars: 100, keepRecent: 1 });
      const stub = JSON.parse(result.filter(m => m.role === 'tool')[0].content);
      expect(stub.compressed).toBe(true);
      expect(stub.tool).toBe('execute_sql');
      expect(stub.input).toBeUndefined();
    });

    it('should handle orphaned tool messages with no matching tool call', () => {
      const messages = [
        { role: 'user', content: 'U' },
        { role: 'tool', tool_call_id: 'ghost', content: 'Z'.repeat(400) },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'real', type: 'function', function: { name: 'get_stats', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'real', content: '{"ok":true}' },
      ];

      const result = compressHistory(messages, { maxChars: 100, keepRecent: 1 });
      const stub = JSON.parse(result.filter(m => m.role === 'tool')[0].content);
      expect(stub.compressed).toBe(true);
      expect(stub.tool).toBeUndefined();
    });

    it('should respect custom keepRecent values', () => {
      const messages = makeHistory(5);
      const result = compressHistory(messages, { maxChars: 1000, keepRecent: 4 });

      const toolMessages = result.filter(m => m.role === 'tool');
      expect(JSON.parse(toolMessages[0].content).compressed).toBe(true);
      for (let i = 1; i < toolMessages.length; i++) {
        expect(JSON.parse(toolMessages[i].content).compressed).toBeUndefined();
      }
    });

    it('should produce a smaller history than the original', () => {
      const messages = makeHistory(8, 800);
      const result = compressHistory(messages, { maxChars: 1500, keepRecent: 3 });
      expect(estimateSize(result)).toBeLessThan(estimateSize(messages));
    });

    it('should not mutate the input array', () => {
      const messages = makeHistory(4);
      const snapshot = JSON.parse(JSON.stringify(messages));
      compressHistory(messages, { maxChars: 500 });
      expect(messages).toEqual(snapshot);
    });
  });
});
