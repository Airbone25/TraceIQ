import Groq from 'groq-sdk';
import pino from 'pino';
import env from '../config/env.js';

const logger = pino({ name: 'llm-groq' });

let client = null;

function getClient() {
  if (!client) {
    client = new Groq({ apiKey: env.GROQ_API_KEY });
  }
  return client;
}

export async function chatCompletion({ messages, tools, temperature = 0.1 }) {
  const start = Date.now();

  const params = {
    model: 'openai/gpt-oss-120b',
    messages,
    temperature,
    max_tokens: 4096,
  };

  if (tools && tools.length > 0) {
    params.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    params.tool_choice = 'auto';
  }

  logger.debug({ messageCount: messages.length, hasTools: !!tools?.length }, 'Calling Groq API');

  const response = await getClient().chat.completions.create(params);

  const duration = Date.now() - start;
  const choice = response.choices?.[0];

  logger.info({
    duration,
    finishReason: choice?.finish_reason,
    toolCalls: choice?.message?.tool_calls?.length || 0,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
  }, 'Groq API response received');

  return {
    message: choice?.message,
    finishReason: choice?.finish_reason,
    usage: response.usage,
    duration,
  };
}
