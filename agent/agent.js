import pino from 'pino';
import { buildSystemPrompt } from './prompts.js';
import { createAgentState, canTakeStep, canRunSql, hasTimedOut, isDuplicateSql, recordToolCall, recordLlmCall, markCompleted, markFailed } from './state.js';
import { ToolRegistry } from '../tools/registry.js';
import { schemaTool } from '../tools/schema.tool.js';
import { sqlTool } from '../tools/sql.tool.js';
import { statsTool } from '../tools/stats.tool.js';
import { chatCompletion } from '../llm/groq.js';
import { createInvestigation, addStep, finalizeInvestigation } from '../database/investigation-store.js';

const logger = pino({ name: 'agent' });

const registry = new ToolRegistry();
registry.register(schemaTool);
registry.register(sqlTool);
registry.register(statsTool);

export async function runInvestigation(userQuestion) {
  const state = createAgentState(userQuestion);
  let investigationId = null;

  try {
    const { id } = await createInvestigation(userQuestion);
    investigationId = id;

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userQuestion },
    ];

    const toolDefs = registry.getDefinitions();
    let lastToolBatchEnd = state.startTime;

    while (canTakeStep(state) && !hasTimedOut(state)) {
      state.overheadDuration += Date.now() - lastToolBatchEnd;

      const response = await chatCompletion({ messages, tools: toolDefs });
      recordLlmCall(state, response);

      messages.push(response.message);

      if (response.finishReason === 'stop' || !response.message?.tool_calls?.length) {
        const answer = response.message?.content || 'No answer generated.';
        markCompleted(state, answer);
        break;
      }

      for (const toolCall of response.message.tool_calls) {
        if (!canTakeStep(state) || hasTimedOut(state)) break;

        const toolName = toolCall.function.name;
        let toolInput;
        try {
          toolInput = JSON.parse(toolCall.function.arguments);
        } catch {
          toolInput = {};
        }

        if (toolName === 'execute_sql' && !canRunSql(state)) {
          const skipResult = { success: false, error: 'SQL query limit reached.' };
          state.failedToolCalls++;
          recordToolCall(state, toolName, toolInput, skipResult, 0);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(skipResult),
          });
          await persistStep(investigationId, state, toolName, toolInput, skipResult, 0);
          continue;
        }

        if (toolName === 'execute_sql' && toolInput.sql && isDuplicateSql(state, toolInput.sql)) {
          const dupeResult = { success: true, deduplicated: true, note: 'This exact query was already executed. Results are in a previous step.' };
          recordToolCall(state, toolName, toolInput, dupeResult, 0);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(dupeResult),
          });
          await persistStep(investigationId, state, toolName, toolInput, dupeResult, 0);
          continue;
        }

        logger.info({ tool: toolName, step: state.steps + 1 }, 'Executing tool');
        const start = Date.now();
        let result;
        try {
          result = await registry.execute(toolName, toolInput);
        } catch (err) {
          result = { success: false, error: err.message };
        }
        const duration = Date.now() - start;
        state.toolDuration += duration;

        if (toolName === 'execute_sql') {
          state.sqlQueries++;
          state.sqlDurations.push(duration);
        }
        if (result.success === false || result.error) {
          state.failedToolCalls++;
        }
        recordToolCall(state, toolName, toolInput, result, duration);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
        await persistStep(investigationId, state, toolName, toolInput, result, duration);
      }
      lastToolBatchEnd = Date.now();
    }

    if (state.status === 'running') {
      markCompleted(state, 'Investigation reached step/timeout limit. Partial results may be available in the step history.');
    }

    await finalizeInvestigation(investigationId, {
      status: state.status,
      answer: state.finalAnswer,
      error: state.errors.length > 0 ? state.errors.join('; ') : null,
      steps: state.steps,
      sqlQueries: state.sqlQueries,
      durationMs: state.totalDuration,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Agent error');
    markFailed(state, err.message);

    if (investigationId) {
      try {
        await finalizeInvestigation(investigationId, {
          status: 'failed',
          answer: null,
          error: err.message,
          steps: state.steps,
          sqlQueries: state.sqlQueries,
          durationMs: state.totalDuration,
        });
      } catch (finalizeErr) {
        logger.error({ err: finalizeErr.message }, 'Failed to finalize investigation');
      }
    }
  }

  return {
    investigationId,
    question: state.userQuestion,
    status: state.status,
    answer: state.finalAnswer,
    steps: state.steps,
    sqlQueries: state.sqlQueries,
    toolCalls: state.toolCalls,
    errors: state.errors,
    totalDuration: state.totalDuration,
    llmCalls: state.llmCalls,
    llmDuration: state.llmDuration,
    toolDuration: state.toolDuration,
    llmCallDetails: state.llmCallDetails,
    sqlDurations: state.sqlDurations,
    failedToolCalls: state.failedToolCalls,
    overheadDuration: state.overheadDuration,
  };
}

async function persistStep(investigationId, state, toolName, toolInput, result, duration) {
  try {
    await addStep(investigationId, state.steps, toolName, toolInput, result, duration);
  } catch (err) {
    logger.error({ err: err.message, investigationId }, 'Failed to persist step');
  }
}
