export function assertAnswerContains(answer, keywords, label) {
  const lower = answer.toLowerCase();
  const found = keywords.filter(kw => lower.includes(kw.toLowerCase()));
  const missing = keywords.filter(kw => !lower.includes(kw.toLowerCase()));
  return {
    passed: missing.length === 0,
    label,
    found,
    missing,
  };
}

export function assertAnswerMatches(answer, patterns, label) {
  const matches = patterns.filter(p => p.test(answer));
  const notMatched = patterns.filter(p => !p.test(answer));
  return {
    passed: notMatched.length === 0,
    label,
    matched: matches.length,
    total: patterns.length,
  };
}

export function assertToolUsed(result, toolName, label) {
  const used = result.toolCalls.some(tc => tc.toolName === toolName);
  return {
    passed: used,
    label,
    toolName,
  };
}

export function assertStatus(result, expectedStatus, label) {
  return {
    passed: result.status === expectedStatus,
    label,
    expected: expectedStatus,
    actual: result.status,
  };
}

export function assertStepCount(result, minSteps, label) {
  return {
    passed: result.steps >= minSteps,
    label,
    expected: `>=${minSteps}`,
    actual: result.steps,
  };
}

export function assertSqlQueriesUsed(result, minQueries, label) {
  return {
    passed: result.sqlQueries >= minQueries,
    label,
    expected: `>=${minQueries}`,
    actual: result.sqlQueries,
  };
}

export function assertInvestigationPersisted(investigationId, label) {
  return {
    passed: investigationId != null && typeof investigationId === 'string' && investigationId.length > 0,
    label,
    investigationId,
  };
}
