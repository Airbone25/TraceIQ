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

export function recordToolCall(state, toolName, input, output, duration) {
  state.steps++;
  if (toolName === 'execute_sql') {
    state.sqlQueries++;
  }
  state.toolCalls.push({
    step: state.steps,
    toolName,
    input,
    outputSummary: typeof output === 'object' ? JSON.stringify(output).substring(0, 500) : String(output).substring(0, 500),
    duration,
  });
  state.observations.push(output);
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
