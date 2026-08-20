import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertAnswerContains,
  assertAnswerMatches,
  assertToolUsed,
  assertStatus,
  assertStepCount,
  assertSqlQueriesUsed,
  assertInvestigationPersisted,
} from '../evaluation/assertions.js';
import { runScenario } from '../evaluation/runner.js';
import russianOrderDecline from '../evaluation/scenarios/russian-order-decline.js';
import mobilePaymentFailures from '../evaluation/scenarios/mobile-payment-failures.js';
import enterpriseBulkCancellation from '../evaluation/scenarios/enterprise-bulk-cancellation.js';

describe('Evaluation Assertions', () => {
  describe('assertAnswerContains', () => {
    it('should pass when all keywords are found', () => {
      const result = assertAnswerContains('Russia stopped ordering', ['russia', 'stopped'], 'test');
      expect(result.passed).toBe(true);
    });

    it('should fail when keywords are missing', () => {
      const result = assertAnswerContains('Orders dropped', ['russia', 'china'], 'test');
      expect(result.passed).toBe(false);
      expect(result.missing).toContain('russia');
      expect(result.missing).toContain('china');
    });

    it('should be case-insensitive', () => {
      const result = assertAnswerContains('RUSSIA is mentioned', ['russia'], 'test');
      expect(result.passed).toBe(true);
    });
  });

  describe('assertAnswerMatches', () => {
    it('should pass when all patterns match', () => {
      const result = assertAnswerMatches('Russia and mobile issues', [/russia/i, /mobile/i], 'test');
      expect(result.passed).toBe(true);
    });

    it('should fail when patterns do not match', () => {
      const result = assertAnswerMatches('Orders dropped', [/russia/i], 'test');
      expect(result.passed).toBe(false);
    });
  });

  describe('assertToolUsed', () => {
    it('should pass when tool was used', () => {
      const result = assertToolUsed({ toolCalls: [{ toolName: 'get_schema' }] }, 'get_schema', 'test');
      expect(result.passed).toBe(true);
    });

    it('should fail when tool was not used', () => {
      const result = assertToolUsed({ toolCalls: [{ toolName: 'execute_sql' }] }, 'get_schema', 'test');
      expect(result.passed).toBe(false);
    });

    it('should handle real agent result shape with toolName property', () => {
      const realAgentResult = {
        toolCalls: [
          { step: 1, toolName: 'get_schema', input: {}, outputSummary: '{}', duration: 100 },
          { step: 2, toolName: 'get_stats', input: {}, outputSummary: '{}', duration: 50 },
          { step: 3, toolName: 'execute_sql', input: {}, outputSummary: '{}', duration: 200 },
        ],
      };
      const result = assertToolUsed(realAgentResult, 'get_stats', 'test');
      expect(result.passed).toBe(true);
    });
  });

  describe('assertStatus', () => {
    it('should pass when status matches', () => {
      const result = assertStatus({ status: 'completed' }, 'completed', 'test');
      expect(result.passed).toBe(true);
    });

    it('should fail when status does not match', () => {
      const result = assertStatus({ status: 'failed' }, 'completed', 'test');
      expect(result.passed).toBe(false);
    });
  });

  describe('assertStepCount', () => {
    it('should pass when steps meet minimum', () => {
      const result = assertStepCount({ steps: 5 }, 3, 'test');
      expect(result.passed).toBe(true);
    });

    it('should fail when steps are below minimum', () => {
      const result = assertStepCount({ steps: 1 }, 3, 'test');
      expect(result.passed).toBe(false);
    });
  });

  describe('assertSqlQueriesUsed', () => {
    it('should pass when SQL queries meet minimum', () => {
      const result = assertSqlQueriesUsed({ sqlQueries: 3 }, 2, 'test');
      expect(result.passed).toBe(true);
    });

    it('should fail when SQL queries are below minimum', () => {
      const result = assertSqlQueriesUsed({ sqlQueries: 0 }, 1, 'test');
      expect(result.passed).toBe(false);
    });
  });

  describe('assertInvestigationPersisted', () => {
    it('should pass when investigationId is valid', () => {
      const result = assertInvestigationPersisted('123e4567-e89b-12d3-a456-426614174000', 'test');
      expect(result.passed).toBe(true);
    });

    it('should fail when investigationId is null', () => {
      const result = assertInvestigationPersisted(null, 'test');
      expect(result.passed).toBe(false);
    });

    it('should fail when investigationId is empty string', () => {
      const result = assertInvestigationPersisted('', 'test');
      expect(result.passed).toBe(false);
    });
  });
});

describe('Evaluation Runner (with mocked agent)', () => {
  it('should run a scenario and return results', async () => {
    const mockRunInvestigation = vi.fn().mockResolvedValue({
      investigationId: 'test-id-123',
      status: 'completed',
      answer: 'Russia orders stopped after day 22 due to payment gateway issues',
      steps: 4,
      sqlQueries: 2,
      toolCalls: [
        { toolName: 'get_schema' },
        { toolName: 'get_stats' },
        { toolName: 'execute_sql' },
      ],
      totalDuration: 15000,
    });

    const result = await runScenario(russianOrderDecline, mockRunInvestigation);
    expect(result.scenarioId).toBe('russian-order-decline');
    expect(result.result.investigationId).toBe('test-id-123');
    expect(result.total).toBeGreaterThan(0);
    expect(mockRunInvestigation).toHaveBeenCalledWith(russianOrderDecline.question);
  });

  it('should handle failed investigation status', async () => {
    const mockRunInvestigation = vi.fn().mockResolvedValue({
      investigationId: 'test-id-456',
      status: 'failed',
      answer: null,
      steps: 0,
      sqlQueries: 0,
      toolCalls: [],
      totalDuration: 1000,
    });

    const result = await runScenario(mobilePaymentFailures, mockRunInvestigation);
    const statusCheck = result.checks.find(c => c.label === 'Status is completed');
    expect(statusCheck.passed).toBe(false);
  });

  it('should detect missing required keywords', async () => {
    const mockRunInvestigation = vi.fn().mockResolvedValue({
      investigationId: 'test-id-789',
      status: 'completed',
      answer: 'Orders dropped because of reasons',
      steps: 3,
      sqlQueries: 1,
      toolCalls: [{ toolName: 'get_schema' }, { toolName: 'get_stats' }],
      totalDuration: 10000,
    });

    const result = await runScenario(enterpriseBulkCancellation, mockRunInvestigation);
    const keywordCheck = result.checks.find(c => c.label === 'Required keywords present');
    expect(keywordCheck.passed).toBe(false);
  });
});

describe('Scenario Definitions', () => {
  it('russian-order-decline should have required fields', () => {
    expect(russianOrderDecline.id).toBeTruthy();
    expect(russianOrderDecline.question).toBeTruthy();
    expect(russianOrderDecline.groundTruth).toBeTruthy();
    expect(russianOrderDecline.acceptableFindings).toBeInstanceOf(Array);
    expect(russianOrderDecline.requiredKeywords).toBeInstanceOf(Array);
  });

  it('mobile-payment-failures should have required fields', () => {
    expect(mobilePaymentFailures.id).toBeTruthy();
    expect(mobilePaymentFailures.question).toBeTruthy();
    expect(mobilePaymentFailures.groundTruth).toBeTruthy();
    expect(mobilePaymentFailures.acceptableFindings).toBeInstanceOf(Array);
    expect(mobilePaymentFailures.requiredKeywords).toBeInstanceOf(Array);
  });

  it('enterprise-bulk-cancellation should have required fields', () => {
    expect(enterpriseBulkCancellation.id).toBeTruthy();
    expect(enterpriseBulkCancellation.question).toBeTruthy();
    expect(enterpriseBulkCancellation.groundTruth).toBeTruthy();
    expect(enterpriseBulkCancellation.acceptableFindings).toBeInstanceOf(Array);
    expect(enterpriseBulkCancellation.requiredKeywords).toBeInstanceOf(Array);
  });
});
