import env from '../config/env.js';

export function createAgentState(userQuestion) {
  return {
    userQuestion,
    steps: 0,
    sqlQueries: 0,
    toolCalls: [],
    observations: [],
    startTime: Date.now(),
    status: 'running',
    finalAnswer: null,
    errors: [],
    llmCalls: 0,
    llmDuration: 0,
    toolDuration: 0,
    llmCallDetails: [],
    seenSqlHashes: new Set(),
    sqlDurations: [],
    failedToolCalls: 0,
    overheadDuration: 0,
  };
}

export function canTakeStep(state) {
  return state.steps < env.MAX_AGENT_STEPS;
}

export function canRunSql(state) {
  return state.sqlQueries < env.MAX_SQL_QUERIES;
}

export function hasTimedOut(state) {
  return (Date.now() - state.startTime) >= env.MAX_EXECUTION_TIME_MS;
}

export function isDuplicateSql(state, sql) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (state.seenSqlHashes.has(normalized)) {
    return true;
  }
  state.seenSqlHashes.add(normalized);
  return false;
}

export function recordToolCall(state, toolName, input, output, duration) {
  state.steps++;
  state.toolCalls.push({
    step: state.steps,
    toolName,
    input,
    outputSummary: typeof output === 'object' ? JSON.stringify(output).substring(0, 500) : String(output).substring(0, 500),
    duration,
  });
  state.observations.push(output);
}

export function recordLlmCall(state, response) {
  state.llmCalls++;
  state.llmDuration += response.duration;
  state.llmCallDetails.push({
    callNumber: state.llmCalls,
    duration: response.duration,
    model: response.model,
    finishReason: response.finishReason,
    toolCallCount: response.toolCallCount,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    error: response.error,
  });
}

export function markCompleted(state, answer) {
  state.status = 'completed';
  state.finalAnswer = answer;
  state.endTime = Date.now();
  state.totalDuration = state.endTime - state.startTime;
}

export function markFailed(state, error) {
  state.status = 'failed';
  state.errors.push(error);
  state.endTime = Date.now();
  state.totalDuration = state.endTime - state.startTime;
}
