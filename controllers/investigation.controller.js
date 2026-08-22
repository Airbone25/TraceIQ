import pino from 'pino';
import { testConnection } from '../database/mysql.js';
import { getInvestigation, listInvestigations, createInvestigation } from '../database/investigation-store.js';
import { startJob } from '../services/job-runner.js';
import env from '../config/env.js';

const logger = pino({ name: 'controller' });

export function validateQuestion(req) {
  const { question } = req.body;
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return { error: 'question is required and must be a non-empty string' };
  }
  const trimmed = question.trim();
  if (trimmed.length > env.MAX_QUESTION_LENGTH) {
    return {
      error: `question exceeds maximum length of ${env.MAX_QUESTION_LENGTH} characters`,
      maxLength: env.MAX_QUESTION_LENGTH,
      actualLength: trimmed.length,
    };
  }
  return { value: trimmed };
}

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
  const validation = validateQuestion(req);
  if (validation.error) {
    return res.status(400).json(validation);
  }
  const question = validation.value;

  logger.info({ question }, 'Investigation requested');

  try {
    const { id } = await createInvestigation(question, null, req.userId);
    res.status(202).json({ investigationId: id, status: 'queued' });
    startJob({ investigationId: id, question });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to queue investigation');
    res.status(500).json({ error: 'Failed to queue investigation', detail: err.message });
  }
}

export async function getInvestigationById(req, res) {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Investigation ID is required' });
  }

  try {
    const investigation = await getInvestigation(id, req.userId);
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
    const investigations = await listInvestigations(req.userId);
    res.json(investigations);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list investigations');
    res.status(500).json({ error: 'Failed to list investigations', detail: err.message });
  }
}
