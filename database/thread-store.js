import crypto from 'crypto';
import pino from 'pino';
import { query } from './mysql.js';

const logger = pino({ name: 'thread-store' });

export function generateThreadId() {
  return crypto.randomUUID();
}

export async function createThread(title) {
  const id = generateThreadId();
  await query('INSERT INTO investigation_threads (id, title) VALUES (?, ?)', [id, title]);
  logger.info({ id, title }, 'Thread created');
  return { id, title };
}

export async function addMessage(threadId, role, content) {
  await query(
    'INSERT INTO investigation_messages (thread_id, role, content) VALUES (?, ?, ?)',
    [threadId, role, content]
  );
  await query('UPDATE investigation_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [threadId]);
}

export async function getMessages(threadId) {
  return query(
    'SELECT id, role, content, created_at FROM investigation_messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC',
    [threadId]
  );
}

export async function listThreads() {
  return query(`
    SELECT t.id, t.title, t.created_at, t.updated_at,
      (SELECT status FROM investigations i WHERE i.thread_id = t.id ORDER BY i.started_at DESC LIMIT 1) AS latest_status,
      (SELECT COUNT(*) FROM investigation_messages m WHERE m.thread_id = t.id) AS message_count
    FROM investigation_threads t
    ORDER BY t.updated_at DESC
  `);
}

export async function getThread(id) {
  const rows = await query('SELECT * FROM investigation_threads WHERE id = ?', [id]);
  return rows.length > 0 ? rows[0] : null;
}

export async function getThreadRuns(threadId) {
  return query(
    `SELECT id, question, status, started_at, completed_at, duration_ms, steps, sql_queries, final_answer, error
     FROM investigations WHERE thread_id = ? ORDER BY started_at ASC`,
    [threadId]
  );
}

export async function getLatestRunSteps(threadId) {
  const runs = await query(
    'SELECT id FROM investigations WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1',
    [threadId]
  );
  if (runs.length === 0) return [];
  return query(
    'SELECT step_number, tool_name, tool_input, tool_output, duration_ms, created_at FROM investigation_steps WHERE investigation_id = ? ORDER BY step_number ASC',
    [runs[0].id]
  );
}

export async function hasActiveRun(threadId) {
  const rows = await query(
    "SELECT COUNT(*) AS cnt FROM investigations WHERE thread_id = ? AND status = 'running'",
    [threadId]
  );
  return rows[0].cnt > 0;
}

export async function getThreadContext(threadId, maxTurns) {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(maxTurns) || 1)));
  const rows = await query(
    `SELECT question, final_answer FROM investigations
     WHERE thread_id = ? AND status = 'completed' AND final_answer IS NOT NULL
     ORDER BY started_at DESC LIMIT ${limit}`,
    [threadId]
  );
  return rows.reverse().map(r => ({ question: r.question, answer: r.final_answer }));
}
