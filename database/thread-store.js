import crypto from 'crypto';
import pino from 'pino';
import { Thread, Message, Investigation, Step } from './collections/index.js';

const logger = pino({ name: 'thread-store' });

async function safeQuery(run, onNull) {
  try {
    return await run();
  } catch (err) {
    if (err && err.name === 'CastError') return onNull;
    throw err;
  }
}

export function generateThreadId() {
  return crypto.randomUUID();
}

function mapThread(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    user_id: String(doc.userId),
    connection_id: doc.connectionId ? String(doc.connectionId) : null,
    target_database: doc.database || null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

function mapMessage(doc) {
  return {
    id: String(doc._id),
    role: doc.role,
    content: doc.content,
    created_at: doc.created_at,
  };
}

function mapRun(doc) {
  return {
    id: String(doc._id),
    question: doc.question,
    status: doc.status,
    thread_id: doc.threadId ? String(doc.threadId) : null,
    started_at: doc.created_at,
    completed_at: doc.updated_at,
    duration_ms: doc.totalDurationMs ?? doc.durationMs ?? null,
    steps: doc.steps ?? 0,
    sql_queries: doc.sqlQueries ?? 0,
    final_answer: doc.finalAnswer ?? null,
    error: doc.error ?? null,
  };
}

function mapStep(doc) {
  return {
    id: String(doc._id),
    step_number: doc.stepNumber ?? 0,
    tool_name: doc.toolName ?? null,
    tool_input: doc.toolInput ?? null,
    tool_output: doc.toolOutput ?? null,
    duration_ms: doc.durationMs ?? 0,
    created_at: doc.created_at,
  };
}

export async function createThread(title, { connectionId = null, database = null, userId = null } = {}) {
  const doc = await Thread.create({ title, userId, connectionId, database });
  const id = String(doc._id);
  logger.info({ id, title, connectionId, database }, 'Thread created');
  return { id, title, connectionId, database };
}

export async function addMessage(threadId, role, content) {
  const thread = await Thread.findById(threadId);
  if (!thread) return;
  await Message.create({ threadId, userId: thread.userId, role, content });
  thread.updated_at = new Date();
  await thread.save();
}

export async function getMessages(threadId) {
  const docs = await Message.find({ threadId }).sort({ created_at: 1, _id: 1 });
  return docs.map(mapMessage);
}

export async function listThreads(userId) {
  const threads = await Thread.find({ userId }).sort({ updated_at: -1 });
  const ids = threads.map(t => t._id);

  let latestStatuses = new Map();
  if (ids.length) {
    const runs = await Investigation.find({ threadId: { $in: ids } }).sort({ created_at: -1 });
    latestStatuses = new Map();
    for (const r of runs) {
      const key = String(r.threadId);
      if (!latestStatuses.has(key)) latestStatuses.set(key, r.status);
    }
  }

  let messageCounts = new Map();
  if (ids.length) {
    const counts = await Message.aggregate([
      { $match: { threadId: { $in: ids } } },
      { $group: { _id: '$threadId', count: { $sum: 1 } } },
    ]);
    messageCounts = new Map(counts.map(c => [String(c._id), c.count]));
  }

  return threads.map(t => ({
    id: String(t._id),
    title: t.title,
    target_database: t.database || null,
    connection_id: t.connectionId ? String(t.connectionId) : null,
    created_at: t.created_at,
    updated_at: t.updated_at,
    latest_status: latestStatuses.get(String(t._id)) ?? null,
    message_count: messageCounts.get(String(t._id)) ?? 0,
  }));
}

export async function getThread(id, userId = null) {
  const doc = await safeQuery(() =>
    userId ? Thread.findOne({ _id: id, userId }) : Thread.findById(id),
    null,
  );
  return doc ? mapThread(doc) : null;
}

export async function getThreadRuns(threadId) {
  const docs = await Investigation.find({ threadId }).sort({ created_at: 1 });
  return docs.map(mapRun);
}

export async function getLatestRunSteps(threadId) {
  const run = await Investigation.findOne({ threadId }).sort({ created_at: -1 });
  if (!run) return [];
  const steps = await Step.find({ investigationId: run._id }).sort({ stepNumber: 1 });
  return steps.map(mapStep);
}

export async function hasActiveRun(threadId) {
  const count = await Investigation.countDocuments({ threadId, status: 'running' });
  return count > 0;
}

export async function getThreadContext(threadId, maxTurns) {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(maxTurns) || 1)));
  const docs = await Investigation.find({ threadId, status: 'completed', finalAnswer: { $ne: null } })
    .sort({ created_at: -1 })
    .limit(limit);
  return docs.reverse().map(r => ({ question: r.question, answer: r.finalAnswer }));
}

export async function deleteThread(id, userId = null) {
  const existing = await getThread(id, userId);
  if (!existing) return false;

  const investigationIds = (await Investigation.find({ threadId: id }).select('_id')).map(i => i._id);
  await Step.deleteMany({ investigationId: { $in: investigationIds } });
  await Investigation.deleteMany({ threadId: id });
  await Message.deleteMany({ threadId: id });
  await Thread.deleteOne({ _id: id });

  logger.info({ id }, 'Thread deleted');
  return true;
}
