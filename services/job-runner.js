import pino from 'pino';
import { runInvestigation } from '../agent/agent.js';
import { investigationRateLimiter } from '../llm/rate-limiter.js';
import { finalizeInvestigation } from '../database/investigation-store.js';
import { addMessage, getThread } from '../database/thread-store.js';
import { getUserGroqConfig } from '../database/user-store.js';

const logger = pino({ name: 'job-runner' });

const activeJobs = new Map();

export function startJob({ investigationId, question, threadId = null, threadContext = [], userId = null }) {
  const record = { cancelled: false };
  const promise = executeJob({ investigationId, question, threadId, threadContext, userId, record })
    .catch(err => {
      logger.error({ err: err.message, investigationId }, 'Background job crashed');
    })
    .finally(() => activeJobs.delete(investigationId));
  record.promise = promise;
  activeJobs.set(investigationId, record);
  return promise;
}

export function isJobActive(investigationId) {
  return activeJobs.has(investigationId);
}

export function activeJobCount() {
  return activeJobs.size;
}

// Requests cancellation of an in-flight job. Idempotent and a no-op for
// unknown/inactive ids. The running agent loop observes the flag between steps.
export function cancelJob(investigationId) {
  const record = activeJobs.get(investigationId);
  if (!record) {
    return false;
  }
  if (record.cancelled) {
    return true;
  }
  record.cancelled = true;
  logger.info({ investigationId }, 'Cancellation requested for job');
  return true;
}

async function executeJob({ investigationId, question, threadId, threadContext, userId, record }) {
  try {
    await investigationRateLimiter.acquire();
  } catch (err) {
    logger.warn({ investigationId, waitedMs: err.waitedMs }, 'Queue timeout before job could start');
    await safeFinalize(investigationId, `Queued too long without a slot: ${err.message}`);
    return { investigationId, status: 'failed', error: err.message };
  }

  try {
    if (record.cancelled) {
      await finalizeAs(investigationId, 'cancelled', 'Investigation cancelled before it started');
      return { investigationId, status: 'cancelled' };
    }

    let connectionId = null;
    let database = null;
    if (threadId) {
      const thread = await getThread(threadId).catch(() => null);
      if (thread) {
        connectionId = thread.connection_id || null;
        database = thread.target_database || null;
      }
    }
    let groqConfig = null;
    if (userId) {
      const cfg = await getUserGroqConfig(userId).catch(() => null);
      if (cfg && cfg.apiKey) {
        groqConfig = { apiKey: cfg.apiKey, model: cfg.model || null };
      }
    }
    const runOpts = {
      investigationId,
      threadId,
      threadContext,
      connectionId,
      database,
      shouldCancel: () => record.cancelled,
    };
    if (groqConfig) runOpts.groqConfig = groqConfig;
    const result = await runInvestigation(question, runOpts);
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

async function finalizeAs(investigationId, status, error) {
  try {
    await finalizeInvestigation(investigationId, {
      status,
      answer: null,
      error,
      steps: 0,
      sqlQueries: 0,
      durationMs: 0,
    });
  } catch (err) {
    logger.error({ err: err.message, investigationId }, 'Failed to persist cancellation');
  }
}
