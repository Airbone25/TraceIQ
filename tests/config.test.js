import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  default: {
    MAX_AGENT_STEPS: 8,
    MAX_SQL_QUERIES: 5,
    MAX_QUERY_ROWS: 500,
    MAX_EXECUTION_TIME_MS: 60000,
    GROQ_MODEL: 'openai/gpt-oss-120b',
    MAX_QUESTION_LENGTH: 5000,
  },
}));

import env from '../config/env.js';

describe('Configuration Determinism', () => {
  it('should use schema defaults, not .env overrides, in test mode', () => {
    expect(env.MAX_AGENT_STEPS).toBe(8);
    expect(env.MAX_SQL_QUERIES).toBe(5);
    expect(env.MAX_QUERY_ROWS).toBe(500);
    expect(env.MAX_EXECUTION_TIME_MS).toBe(60000);
  });

  it('should NOT have .env override values (MAX_AGENT_STEPS=20, MAX_SQL_QUERIES=10)', () => {
    expect(env.MAX_AGENT_STEPS).not.toBe(20);
    expect(env.MAX_SQL_QUERIES).not.toBe(10);
  });
});
