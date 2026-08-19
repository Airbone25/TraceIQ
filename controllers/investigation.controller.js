import pino from 'pino';
import { testConnection } from '../database/mysql.js';
import { runInvestigation } from '../agent/agent.js';

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

  logger.info({ question: question.trim() }, 'Investigation requested');

  try {
    const result = await runInvestigation(question.trim());
    res.json(result);
  } catch (err) {
    logger.error({ err: err.message }, 'Investigation failed');
    res.status(500).json({ error: 'Investigation failed', detail: err.message });
  }
}
