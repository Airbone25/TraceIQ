import pino from 'pino';
import { runInvestigation } from '../agent/agent.js';
import { investigationRateLimiter } from '../llm/rate-limiter.js';
import { finalizeInvestigation } from '../database/investigation-store.js';
import { addMessage, getThread } from '../database/thread-store.js';

const logger = pino({ name: 'job-runner' });

const activeJobs = new Map();

export function startJob({ investigationId, question, threadId = null, threadContext = [] }) {
  const promise = executeJob({ investigationId, question, threadId, threadContext })
    .catch(err => {
      logger.error({ err: err.message, investigationId }, 'Background job crashed');
    })
    .finally(() => activeJobs.delete(investigationId));
  activeJobs.set(investigationId, promise);
  return promise;
}

export function isJobActive(investigationId) {
  return activeJobs.has(investigationId);
}

export function activeJobCount() {
  return activeJobs.size;
}

async function executeJob({ investigationId, question, threadId, threadContext }) {
  try {
    await investigationRateLimiter.acquire();
  } catch (err) {
    logger.warn({ investigationId, waitedMs: err.waitedMs }, 'Queue timeout before job could start');
    await safeFinalize(investigationId, `Queued too long without a slot: ${err.message}`);
    return { investigationId, status: 'failed', error: err.message };
  }

  try {
    let connectionId = null;
    let database = null;
    if (threadId) {
      const thread = await getThread(threadId).catch(() => null);
      if (thread) {
        connectionId = thread.connection_id || null;
        database = thread.target_database || null;
      }
    }
    const result = await runInvestigation(question, { investigationId, threadId, threadContext, connectionId, database });
    if (threadId && result.status === 'completed' && result.answer) {
      const thread = await getThread(threadId).catch(() => null);
      if (thread) {
        await addMessage(threadId, 'assistant', result.answer);
      }
    }
    logger.info({ investigationId, status: result.status }, 'Background job finished');
    return result;
  } finally {
    investigationRateLimiter.release();
  }
}

async function safeFinalize(investigationId, errorMessage) {
  try {
    await finalizeInvestigation(investigationId, {
      status: 'failed',
      answer: null,
      error: errorMessage,
      steps: 0,
      sqlQueries: 0,
      durationMs: 0,
    });
  } catch (err) {
    logger.error({ err: err.message, investigationId }, 'Failed to persist queue-timeout failure');
  }
}
