import pino from 'pino';
import { readFileSync } from 'fs';
import path from 'path';
import { testDbConnection } from '../database/mongodb.js';
import { getInvestigation, listInvestigations, createInvestigation } from '../database/investigation-store.js';
import { getConnectionRow, touchConnection } from '../database/connection-store.js';
import { validateDatabaseName } from './connections.controller.js';
import { startJob, cancelJob } from '../services/job-runner.js';
import env from '../config/env.js';

const logger = pino({ name: 'controller' });

function readAppVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const APP_VERSION = readAppVersion();

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
  const dbOk = await testDbConnection();
  const status = dbOk ? 200 : 503;
  res.status(status).json({
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbOk ? 'connected' : 'disconnected',
    version: APP_VERSION,
  });
}

export async function investigate(req, res) {
  const validation = validateQuestion(req);
  if (validation.error) {
    return res.status(400).json(validation);
  }
  const question = validation.value;

  const connectionId = req.body?.connectionId;
  const database = req.body?.database;
  if (!connectionId || !validateDatabaseName(database)) {
    return res.status(400).json({
      error: 'connectionId and a valid database name are required to target an external database',
      received: { connectionId: connectionId ?? null, database: database ?? null },
    });
  }

  try {
    const connection = await getConnectionRow(connectionId, req.userId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    await touchConnection(connectionId).catch(() => {});
  } catch (err) {
    logger.info({ err: err.message }, 'Investigation target unavailable');
    return res.status(502).json({ error: 'Could not resolve the investigation target', detail: err.message });
  }

  logger.info({ question, connectionId, database }, 'Investigation requested');

  try {
    const { id } = await createInvestigation(question, null, req.userId);
    res.status(202).json({ investigationId: id, status: 'queued', connectionId, database });
    startJob({ investigationId: id, question, connectionId, database, userId: req.userId });
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

export async function cancelInvestigationHandler(req, res) {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Investigation ID is required' });
  }

  try {
    // Ownership check — must belong to the signed-in user.
    const investigation = await getInvestigation(id, req.userId);
    if (!investigation) {
      return res.status(404).json({ error: 'Investigation not found' });
    }

    const cancelled = cancelJob(id);
    if (cancelled) {
      logger.info({ investigationId: id }, 'Investigation cancel requested');
      // The background job will finalize as 'cancelled' shortly.
      return res.status(202).json({ id, status: 'cancelling', ok: true });
    }

    // Job not active: already finished (or was never queued). Idempotent success.
    return res.status(200).json({
      id,
      status: investigation.status,
      ok: true,
      note: investigation.status === 'cancelled' ? 'Already cancelled' : 'Investigation is not currently running',
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to cancel investigation');
    res.status(500).json({ error: 'Failed to cancel investigation', detail: err.message });
  }
}
