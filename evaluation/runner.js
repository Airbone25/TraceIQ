import pino from 'pino';
import {
  assertAnswerContains,
  assertAnswerMatches,
  assertToolUsed,
  assertStatus,
  assertStepCount,
  assertSqlQueriesUsed,
  assertInvestigationPersisted,
} from './assertions.js';

const logger = pino({ name: 'eval-runner' });

export async function runScenario(scenario, runInvestigation) {
  logger.info({ scenario: scenario.id, question: scenario.question }, 'Running evaluation scenario');

  const result = await runInvestigation(scenario.question);

  const checks = [];

  checks.push(assertStatus(result, 'completed', 'Status is completed'));
  checks.push(assertInvestigationPersisted(result.investigationId, 'Investigation persisted'));
  checks.push(assertStepCount(result, scenario.minSteps, `At least ${scenario.minSteps} steps`));
  checks.push(assertSqlQueriesUsed(result, scenario.minSqlQueries, `At least ${scenario.minSqlQueries} SQL queries`));

  if (result.answer) {
    const keywordChecks = scenario.acceptableFindings.map((keywords, i) =>
      assertAnswerContains(result.answer, keywords, `Answer mentions group ${i + 1}: ${keywords.slice(0, 3).join(', ')}...`)
    );
    checks.push(...keywordChecks);

    checks.push(assertAnswerMatches(result.answer, scenario.requiredKeywords.map(kw => new RegExp(kw, 'i')), 'Required keywords present'));
  }

  checks.push(assertToolUsed(result, 'get_schema', 'Used get_schema'));
  checks.push(assertToolUsed(result, 'get_stats', 'Used get_stats'));

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed);

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    question: scenario.question,
    passed,
    failed: failed.length,
    total: checks.length,
    checks,
    result: {
      investigationId: result.investigationId,
      status: result.status,
      answer: result.answer,
      steps: result.steps,
      sqlQueries: result.sqlQueries,
      toolCalls: result.toolCalls?.length || 0,
      duration: result.totalDuration,
    },
  };
}
