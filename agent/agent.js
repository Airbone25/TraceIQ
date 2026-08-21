import pino from 'pino';
import env from '../config/env.js';
import { buildSystemPrompt, buildStallMessage } from './prompts.js';
import { createAgentState, canTakeStep, canRunSql, hasTimedOut, isDuplicateSql, recordToolCall, recordLlmCall, markCompleted, markFailed, shouldNudge, buildNudgeMessage } from './state.js';
import { ToolRegistry } from '../tools/registry.js';
import { schemaTool } from '../tools/schema.tool.js';
import { sqlTool } from '../tools/sql.tool.js';
import { overviewTool } from '../tools/overview.tool.js';
import { chatCompletion, RateLimitError } from '../llm/groq.js';
import { compressHistory } from './context.js';
import { createInvestigation, addStep, finalizeInvestigation } from '../database/investigation-store.js';

const logger = pino({ name: 'agent' });

const STALL_THRESHOLD = 3;

const registry = new ToolRegistry();
registry.register(schemaTool);
registry.register(sqlTool);
registry.register(overviewTool);

function truncateForHistory(result) {
  const json = JSON.stringify(result);
  if (json.length <= env.MAX_TOOL_RESULT_CHARS) {
    return json;
  }
  const truncated = { ...result, data: result.data?.slice?.(0, Math.max(1, Math.floor(result.data.length / 2))) };
  let trimmed = JSON.stringify(truncated);
  if (trimmed.length > env.MAX_TOOL_RESULT_CHARS) {
    trimmed = trimmed.substring(0, env.MAX_TOOL_RESULT_CHARS);
  }
  return trimmed + `...[truncated ${json.length - trimmed.length} chars to fit context]`;
}

const CACHED_TOOLS = new Set(['get_schema', 'get_overview']);
const LIMIT_REACHED_MESSAGE = 'Investigation reached step/timeout limit. Partial results may be available in the step history.';
const SYNTHESIS_PROMPT = 'Your investigation budget is exhausted. Based ONLY on the evidence already gathered in this conversation, write your final answer now in the required format (Conclusion / Key Evidence / Confidence). Do not attempt any further tool calls.';

async function forceFinalSynthesis(messages, state) {
  try {
    logger.info('Investigation budget exhausted; forcing final synthesis');
    const response = await chatCompletion({
      messages: [...messages, { role: 'user', content: SYNTHESIS_PROMPT }],
    });
    recordLlmCall(state, response);
    const content = response.message?.content?.trim();
    return content ? content : null;
  } catch (err) {
    logger.warn({ err: err.message }, 'Forced final synthesis failed');
    return null;
  }
}

function buildThreadContextMessage(threadContext) {
  const maxChars = env.THREAD_CONTEXT_ANSWER_CHARS ?? 2000;
  const sections = threadContext.map(turn => {
    const answer = turn.answer.length > maxChars
      ? turn.answer.substring(0, maxChars) + '...[truncated]'
      : turn.answer;
    return `Q: ${turn.question}\nA: ${answer}`;
  });
  return [
    'Prior findings from earlier questions in this investigation thread:',
    '',
    sections.join('\n\n'),
    '',
    'Use these findings as context. Do not repeat identical queries already answered above unless deeper detail is needed.',
  ].join('\n');
}

async function loadDatabaseOverview() {
  const result = await overviewTool.execute({});
  if (!result?.success) {
    throw new Error(result?.error || 'Overview unavailable');
  }
  return result;
}

function renderDatabaseOverview(overview) {
  const lines = ['## Database Overview (auto-generated)', ''];
  const tables = Array.isArray(overview.tables) ? overview.tables : [];
  if (tables.length > 0) {
    lines.push(`Tables: ${tables.map(t => `${t.name} (${t.rowCount} rows)`).join(', ')}`);
  }
  const ranges = Array.isArray(overview.dateRanges) ? overview.dateRanges : [];
  if (ranges.length > 0) {
    lines.push('');
    lines.push('Time ranges:');
    for (const r of ranges.slice(0, 20)) {
      lines.push(`- ${r.table}.${r.column}: ${r.min} -> ${r.max}`);
    }
    if (ranges.length > 20) {
      lines.push(`- ...and ${ranges.length - 20} more`);
    }
  }
  return lines.join('\n');
}

export async function runInvestigation(userQuestion, options = {}) {
  const { investigationId: existingId = null, threadId = null, threadContext = [] } = options;
  const state = createAgentState(userQuestion);
  let investigationId = existingId;

  try {
    if (!investigationId) {
      const { id } = await createInvestigation(userQuestion, threadId);
      investigationId = id;
    }

    let messages = [
      { role: 'system', content: buildSystemPrompt() },
    ];

    try {
      const overview = await loadDatabaseOverview();
      messages.push({ role: 'system', content: renderDatabaseOverview(overview) });
      logger.info('Database overview injected');
    } catch (err) {
      logger.warn({ err: err.message }, 'Database overview unavailable; continuing without it');
    }

    if (threadContext.length > 0) {
      messages.push({ role: 'system', content: buildThreadContextMessage(threadContext) });
    }

    messages.push({ role: 'user', content: userQuestion });

    const toolDefs = registry.getDefinitions();
    const toolCache = new Map();
    let lastToolBatchEnd = state.startTime;
    let consecutiveNonSqlTools = 0;
    let stallNudged = false;

    while (canTakeStep(state) && !hasTimedOut(state)) {
      state.overheadDuration += Date.now() - lastToolBatchEnd;

      if (shouldNudge(state)) {
        state.nudged = true;
        messages.push({ role: 'system', content: buildNudgeMessage(state) });
        logger.info({ step: state.steps }, 'Endgame nudge injected');
      }

      if (!stallNudged && consecutiveNonSqlTools >= STALL_THRESHOLD) {
        stallNudged = true;
        messages.push({ role: 'system', content: buildStallMessage(consecutiveNonSqlTools) });
        logger.info({ step: state.steps, nonSqlToolCalls: consecutiveNonSqlTools }, 'Stall nudge injected');
      }

      messages = compressHistory(messages);
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
        if (toolName === 'execute_sql') {
          consecutiveNonSqlTools = 0;
        } else {
          consecutiveNonSqlTools++;
        }
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
        const cacheKey = `${toolName}:${JSON.stringify(toolInput)}`;
        if (CACHED_TOOLS.has(toolName) && toolCache.has(cacheKey)) {
          result = { ...toolCache.get(cacheKey), cached: true };
          logger.info({ tool: toolName, step: state.steps + 1 }, 'Tool cache hit');
        } else {
          try {
            result = await registry.execute(toolName, toolInput);
          } catch (err) {
            result = { success: false, error: err.message };
          }
          if (CACHED_TOOLS.has(toolName) && result?.success !== false && !result?.error) {
            toolCache.set(cacheKey, result);
          }
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
          content: truncateForHistory(result),
        });
        await persistStep(investigationId, state, toolName, toolInput, result, duration);
      }
      lastToolBatchEnd = Date.now();
    }

    if (state.status === 'running') {
      const synthesized = await forceFinalSynthesis(messages, state);
      markCompleted(state, synthesized || LIMIT_REACHED_MESSAGE);
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

    if (err instanceof RateLimitError) {
      throw err;
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
