import pino from 'pino';
import { testConnection } from '../database/mysql.js';
import { runInvestigation } from '../agent/agent.js';
import { getInvestigation, listInvestigations } from '../database/investigation-store.js';
import { RateLimitError } from '../llm/groq.js';
import { investigationRateLimiter, QueueTimeoutError } from '../llm/rate-limiter.js';
import env from '../config/env.js';

const logger = pino({ name: 'controller' });

export async function healthCheck(req, res) {
  const dbOk = await testConnection();
  const status = dbOk ? 200 : 503;
  res.status(status).json({
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbOk ? 'connected' : 'disconnected',
  });
}

export async function investigate(req, res) {
  const { question } = req.body;
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'question is required and must be a non-empty string' });
  }

  const trimmed = question.trim();
  if (trimmed.length > env.MAX_QUESTION_LENGTH) {
    return res.status(400).json({
      error: `question exceeds maximum length of ${env.MAX_QUESTION_LENGTH} characters`,
      maxLength: env.MAX_QUESTION_LENGTH,
      actualLength: trimmed.length,
    });
  }

  logger.info({ question: trimmed }, 'Investigation requested');

  try {
    await investigationRateLimiter.acquire();
  } catch (err) {
    if (err instanceof QueueTimeoutError) {
      const retryAfterSec = Math.ceil(env.INVESTIGATION_QUEUE_TIMEOUT_MS / 1000);
      logger.warn({ waitedMs: err.waitedMs }, 'Investigation queue timeout');
      return res.status(429).json({
        error: 'Another investigation is already in progress',
        retryAfterSeconds: retryAfterSec,
        detail: err.message,
        suggestion: 'Wait for the current investigation to finish, then try again.',
      });
    }
    throw err;
  }

  try {
    const result = await runInvestigation(trimmed);
    res.json(result);
  } catch (err) {
    if (err instanceof RateLimitError) {
      const retryAfterSec = Math.ceil(err.retryAfterMs / 1000);
      logger.warn({ retryAfterSec }, 'Rate limit exceeded');
      return res.status(429).json({
        error: 'LLM rate limit exceeded',
        retryAfterSeconds: retryAfterSec,
        detail: err.message,
        suggestion: 'Upgrade your Groq tier at https://console.groq.com/settings/billing or try again later.',
      });
    }
    logger.error({ err: err.message }, 'Investigation failed');
    res.status(500).json({ error: 'Investigation failed', detail: err.message });
  } finally {
    investigationRateLimiter.release();
  }
}

export async function getInvestigationById(req, res) {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Investigation ID is required' });
  }

  try {
    const investigation = await getInvestigation(id);
    if (!investigation) {
      return res.status(404).json({ error: 'Investigation not found' });
    }
    res.json(investigation);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to retrieve investigation');
    res.status(500).json({ error: 'Failed to retrieve investigation', detail: err.message });
  }
}

export async function listAllInvestigations(req, res) {
  try {
    const investigations = await listInvestigations();
    res.json(investigations);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list investigations');
    res.status(500).json({ error: 'Failed to list investigations', detail: err.message });
  }
}
