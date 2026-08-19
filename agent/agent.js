import pino from 'pino';
import { buildSystemPrompt } from './prompts.js';
import { createAgentState, canTakeStep, canRunSql, hasTimedOut, recordToolCall, markCompleted, markFailed } from './state.js';
import { ToolRegistry } from '../tools/registry.js';
import { schemaTool } from '../tools/schema.tool.js';
import { sqlTool } from '../tools/sql.tool.js';
import { statsTool } from '../tools/stats.tool.js';
import { chatCompletion } from '../llm/groq.js';

const logger = pino({ name: 'agent' });

const registry = new ToolRegistry();
registry.register(schemaTool);
registry.register(sqlTool);
registry.register(statsTool);

export async function runInvestigation(userQuestion) {
  const state = createAgentState(userQuestion);

  try {
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userQuestion },
    ];

    const toolDefs = registry.getDefinitions();

    while (canTakeStep(state) && !hasTimedOut(state)) {
      const response = await chatCompletion({ messages, tools: toolDefs });

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
          recordToolCall(state, toolName, toolInput, skipResult, 0);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(skipResult),
          });
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

        recordToolCall(state, toolName, toolInput, result, duration);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    if (state.status === 'running') {
      markCompleted(state, 'Investigation reached step/timeout limit. Partial results may be available in the step history.');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Agent error');
    markFailed(state, err.message);
  }

  return {
    question: state.userQuestion,
    status: state.status,
    answer: state.finalAnswer,
    steps: state.steps,
    sqlQueries: state.sqlQueries,
    toolCalls: state.toolCalls,
    errors: state.errors,
    totalDuration: state.totalDuration,
  };
}
