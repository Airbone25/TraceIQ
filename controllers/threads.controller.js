import pino from 'pino';
import { validateQuestion } from './investigation.controller.js';
import {
  createThread,
  addMessage,
  getThread,
  listThreads,
  getMessages,
  getThreadRuns,
  getLatestRunSteps,
  hasActiveRun,
  getThreadContext,
  deleteThread,
} from '../database/thread-store.js';
import { createInvestigation } from '../database/investigation-store.js';
import { getConnectionRow, touchConnection } from '../database/connection-store.js';
import { startJob, cancelJob } from '../services/job-runner.js';
import { subscribe } from '../services/notifier.js';
import { validateDatabaseName } from './connections.controller.js';
import env from '../config/env.js';

const logger = pino({ name: 'threads-controller' });

export async function createThreadHandler(req, res) {
  const validation = validateQuestion(req);
  if (validation.error) {
    return res.status(400).json(validation);
  }
  const question = validation.value;

  let connectionId = null;
  let database = null;
  if (req.body?.connectionId != null || req.body?.database != null) {
    connectionId = req.body.connectionId;
    database = req.body.database;
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
      logger.error({ err: err.message }, 'Failed to verify connection');
      return res.status(500).json({ error: 'Failed to verify connection' });
    }
  }

  try {
    const thread = await createThread(question.substring(0, 255), { connectionId, database, userId: req.userId });
    await addMessage(thread.id, 'user', question);
    const { id: investigationId } = await createInvestigation(question, thread.id, req.userId);

    res.status(202).json({ threadId: thread.id, investigationId, status: 'queued', connectionId, database });
    startJob({ investigationId, question, threadId: thread.id, userId: req.userId });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to create thread');
    res.status(500).json({ error: 'Failed to create thread', detail: err.message });
  }
}

export async function addFollowUpMessage(req, res) {
  const { id } = req.params;
  const validation = validateQuestion(req);
  if (validation.error) {
    return res.status(400).json(validation);
  }
  const question = validation.value;

  try {
    const thread = await getThread(id, req.userId);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if (await hasActiveRun(id)) {
      return res.status(409).json({
        error: 'A follow-up cannot be queued while the current investigation is still running',
        suggestion: 'Wait for the active investigation to finish.',
      });
    }

    if (thread.connection_id) {
      await touchConnection(thread.connection_id).catch(() => {});
    }

    const threadContext = await getThreadContext(id, env.THREAD_CONTEXT_TURNS);
    await addMessage(id, 'user', question);
    const { id: investigationId } = await createInvestigation(question, id, req.userId);

    res.status(202).json({ threadId: id, investigationId, status: 'queued' });
    startJob({ investigationId, question, threadId: id, threadContext, userId: req.userId });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to queue follow-up');
    res.status(500).json({ error: 'Failed to queue follow-up', detail: err.message });
  }
}

export async function listThreadsHandler(req, res) {
  try {
    res.json(await listThreads(req.userId));
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list threads');
    res.status(500).json({ error: 'Failed to list threads', detail: err.message });
  }
}

async function buildThreadDetail(id, userId) {
  const thread = await getThread(id, userId);
  if (!thread) return null;
  const [messages, runs, latestRunSteps] = await Promise.all([
    getMessages(id),
    getThreadRuns(id),
    getLatestRunSteps(id),
  ]);
  return { ...thread, messages, runs, latestRunSteps };
}

export async function getThreadDetail(req, res) {
  const { id } = req.params;
  try {
    const detail = await buildThreadDetail(id, req.userId);
    if (!detail) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    res.json(detail);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to retrieve thread');
    res.status(500).json({ error: 'Failed to retrieve thread', detail: err.message });
  }
}

// Server-Sent Events: live updates for a thread's running investigation.
// The client falls back to 2s polling if this stream errors or stays silent.
export async function streamThreadHandler(req, res) {
  const { id } = req.params;

  // SSE headers must be set before any ownership DB read can fail on auth above.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let closed = false;
  const close = () => { closed = true; };

  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const thread = await getThread(id, req.userId);
    if (!thread) {
      send('error', { error: 'Thread not found' });
      return res.end();
    }
  } catch (err) {
    logger.error({ err: err.message }, 'SSE ownership check failed');
    send('error', { error: 'Thread not found' });
    return res.end();
  }

  req.on('close', close);

  const push = async (kind) => {
    try {
      const detail = await buildThreadDetail(id, req.userId);
      if (detail) send(kind, detail);
    } catch (err) {
      logger.error({ err: err.message, kind }, 'SSE failed to re-hydrate thread');
    }
  };

  // Send the full current state immediately (hydration).
  await push('snapshot');

  const unsubscribe = subscribe(String(id), () => { push('update'); });

  const heartbeat = setInterval(() => {
    if (closed) { clearInterval(heartbeat); return; }
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

export async function deleteThreadHandler(req, res) {
  const { id } = req.params;
  try {
    // Cancel any active investigation on this thread before removing it, so a
    // background job doesn't try to persist a step/assistant message afterwards.
    const runs = await getThreadRuns(id);
    for (const run of runs) {
      if (run.status === 'running') {
        cancelJob(run.id);
        logger.info({ investigationId: run.id, threadId: id }, 'Cancelled active run before thread deletion');
      }
    }

    const deleted = await deleteThread(id, req.userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to delete thread');
    res.status(500).json({ error: 'Failed to delete thread', detail: err.message });
  }
}
