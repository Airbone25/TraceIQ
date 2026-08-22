import crypto from 'crypto';
import pino from 'pino';
import { query } from './mysql.js';

const logger = pino({ name: 'investigation-store' });

export function generateId() {
  return crypto.randomUUID();
}

export async function createInvestigation(question, threadId = null, userId = null) {
  const id = generateId();
  const startedAt = new Date();
  await query(
    'INSERT INTO investigations (id, thread_id, user_id, question, status, started_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, threadId, userId, question, 'running', startedAt]
  );
  logger.info({ id, threadId, question }, 'Investigation created');
  return { id, startedAt };
}

export async function addStep(investigationId, stepNumber, toolName, toolInput, toolOutput, durationMs) {
  await query(
    'INSERT INTO investigation_steps (investigation_id, step_number, tool_name, tool_input, tool_output, duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
    [investigationId, stepNumber, toolName, JSON.stringify(toolInput), JSON.stringify(toolOutput), durationMs]
  );
}

export async function finalizeInvestigation(investigationId, { status, answer, error, steps, sqlQueries, durationMs }) {
  await query(
    'UPDATE investigations SET status = ?, final_answer = ?, error = ?, steps = ?, sql_queries = ?, duration_ms = ?, completed_at = NOW() WHERE id = ?',
    [status, answer || null, error || null, steps, sqlQueries, durationMs, investigationId]
  );
  logger.info({ id: investigationId, status }, 'Investigation finalized');
}

export async function getInvestigation(id, userId = null) {
  const rows = await query(
    'SELECT * FROM investigations WHERE id = ?' + (userId ? ' AND user_id = ?' : ''),
    userId ? [id, userId] : [id]
  );
  if (rows.length === 0) return null;
  const investigation = rows[0];
  const steps = await query(
    'SELECT * FROM investigation_steps WHERE investigation_id = ? ORDER BY step_number ASC',
    [id]
  );
  return { ...investigation, steps };
}

export async function listInvestigations(userId) {
  return query('SELECT * FROM investigations WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

export async function failOrphanedInvestigations() {
  const result = await query(
    "UPDATE investigations SET status = 'failed', error = 'Server restarted while investigation was running', completed_at = NOW() WHERE status = 'running'"
  );
  const affected = result?.affectedRows ?? 0;
  if (affected > 0) {
    logger.warn({ count: affected }, 'Marked orphaned running investigations as failed');
  }
  return affected;
}
