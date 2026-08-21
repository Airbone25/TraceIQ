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

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

export class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

function isRetryableError(err) {
  const status = err?.status || err?.response?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503) {
    return true;
  }
  if (status === 413 && err?.error?.error?.code === 'rate_limit_exceeded') {
    return true;
  }
  const code = err?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return true;
  }
  return false;
}

function getRetryDelay(attempt, err) {
  const retryAfter = err?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
  }
  const jitter = Math.random() * 500;
  return BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
}

export async function chatCompletion({ messages, tools, temperature = 0.1 }) {
  const requestStart = Date.now();
  const model = env.GROQ_MODEL;

  const params = {
    model,
    messages,
    temperature,
    max_tokens: env.LLM_MAX_TOKENS,
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

  logger.debug({ messageCount: messages.length, hasTools: !!tools?.length, model }, 'Calling Groq API');

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = getRetryDelay(attempt - 1, lastError);
      const isRateLimit = [413, 429].includes(lastError?.status) ||
        [413, 429].includes(lastError?.response?.status);

      if (isRateLimit && delay >= MAX_RETRY_DELAY_MS) {
        const retryAfterSec = Math.round(delay / 1000);
        logger.error({ retryAfterSec }, 'Rate limit retry delay too long, failing fast');
        throw new RateLimitError(
          `Rate limit exceeded. Retry after ${retryAfterSec} seconds.`,
          delay,
        );
      }

      logger.warn({ attempt, delay, error: lastError?.message }, 'Retrying Groq API call');
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      const response = await getClient().chat.completions.create(params);

      const requestEnd = Date.now();
      const duration = requestEnd - requestStart;
      const choice = response.choices?.[0];

      logger.info({
        duration,
        attempt,
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
        model,
        requestStart,
        requestEnd,
        toolCallCount: choice?.message?.tool_calls?.length || 0,
        error: null,
      };
    } catch (err) {
      lastError = err;
      logger.error({ error: err.message, attempt, duration: Date.now() - requestStart }, 'Groq API error');

      if (!isRetryableError(err) || attempt === MAX_RETRIES) {
        throw err;
      }
    }
  }
}
