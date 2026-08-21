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
import { startJob } from '../services/job-runner.js';
import env from '../config/env.js';

const logger = pino({ name: 'threads-controller' });

export async function createThreadHandler(req, res) {
  const validation = validateQuestion(req);
  if (validation.error) {
    return res.status(400).json(validation);
  }
  const question = validation.value;

  try {
    const thread = await createThread(question.substring(0, 255));
    await addMessage(thread.id, 'user', question);
    const { id: investigationId } = await createInvestigation(question, thread.id);

    res.status(202).json({ threadId: thread.id, investigationId, status: 'queued' });
    startJob({ investigationId, question, threadId: thread.id });
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
    const thread = await getThread(id);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if (await hasActiveRun(id)) {
      return res.status(409).json({
        error: 'A follow-up cannot be queued while the current investigation is still running',
        suggestion: 'Wait for the active investigation to finish.',
      });
    }

    const threadContext = await getThreadContext(id, env.THREAD_CONTEXT_TURNS);
    await addMessage(id, 'user', question);
    const { id: investigationId } = await createInvestigation(question, id);

    res.status(202).json({ threadId: id, investigationId, status: 'queued' });
    startJob({ investigationId, question, threadId: id, threadContext });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to queue follow-up');
    res.status(500).json({ error: 'Failed to queue follow-up', detail: err.message });
  }
}

export async function listThreadsHandler(req, res) {
  try {
    res.json(await listThreads());
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list threads');
    res.status(500).json({ error: 'Failed to list threads', detail: err.message });
  }
}

export async function getThreadDetail(req, res) {
  const { id } = req.params;
  try {
    const thread = await getThread(id);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    const [messages, runs, latestRunSteps] = await Promise.all([
      getMessages(id),
      getThreadRuns(id),
      getLatestRunSteps(id),
    ]);
    res.json({ ...thread, messages, runs, latestRunSteps });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to retrieve thread');
    res.status(500).json({ error: 'Failed to retrieve thread', detail: err.message });
  }
}

export async function deleteThreadHandler(req, res) {
  const { id } = req.params;
  try {
    const deleted = await deleteThread(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to delete thread');
    res.status(500).json({ error: 'Failed to delete thread', detail: err.message });
  }
}
