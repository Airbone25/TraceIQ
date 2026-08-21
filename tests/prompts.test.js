import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildStallMessage } from '../agent/prompts.js';

describe('System Prompt Heuristics', () => {
  it('should instruct digging past symptoms into payments and order states', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('failure_reason');
    expect(prompt).toContain('cancelled/refunded');
    expect(prompt).toContain('surface the distinct failure_reason values');
  });

  it('should instruct per-group rate computation over blended averages', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain('per group');
    expect(prompt.toLowerCase()).toContain('blended');
  });

  it('should keep existing efficiency and format sections intact', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Investigation Strategy');
    expect(prompt).toContain('Response Format');
    expect(prompt).toContain('**Conclusion:**');
  });
});

describe('Stall Message', () => {
  it('should direct the agent to execute_sql and include the call count', () => {
    const message = buildStallMessage(3);
    expect(message).toContain('3 tool calls');
    expect(message).toContain('execute_sql');
    expect(message).toContain('SELECT');
  });
});
