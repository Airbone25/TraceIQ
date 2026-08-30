import mongoose from 'mongoose';
import { Thread } from '../models/thread.model.js';
import { Message } from '../models/message.model.js';
import { Investigation } from '../models/investigation.model.js';
import { Step } from '../models/step.model.js';
import { Connection } from '../models/connection.model.js';
import { logger } from '../utils/logger.js';

const DB_NAME_RE = /^[A-Za-z0-9_$]+$/;

function threadPublic(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    connectionId: doc.connectionId ? String(doc.connectionId) : null,
    database: doc.database,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

function messagePublic(doc) {
  return { id: String(doc._id), role: doc.role, content: doc.content, created_at: doc.created_at };
}

function investigationPublic(doc) {
  return {
    id: String(doc._id),
    threadId: doc.threadId ? String(doc.threadId) : null,
    question: doc.question,
    status: doc.status,
    finalAnswer: doc.finalAnswer,
    error: doc.error,
    steps: doc.steps,
    sqlQueries: doc.sqlQueries,
    llmCalls: doc.llmCalls,
    created_at: doc.created_at,
  };
}

export async function createThreadHandler(req, res) {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  let connectionId = null;
  let database = null;
  if (req.body?.connectionId != null || req.body?.database != null) {
    connectionId = req.body.connectionId;
    database = req.body.database;
    if (!connectionId || !(typeof database === 'string') || !DB_NAME_RE.test(database)) {
      return res.status(400).json({ error: 'connectionId and a valid database name are required' });
    }
    const conn = await Connection.findOne({ _id: connectionId, userId: req.userId }).catch(() => null);
    if (!conn) {
      return res.status(404).json({ error: 'Connection not found' });
    }
  }

  try {
    const thread = await Thread.create({
      userId: req.userId,
      title: question.slice(0, 255),
      connectionId: connectionId ? new mongoose.Types.ObjectId(connectionId) : null,
      database,
    });
    await Message.create({ userId: req.userId, threadId: thread._id, role: 'user', content: question });
    const investigation = await Investigation.create({
      userId: req.userId,
      threadId: thread._id,
      question,
      status: 'queued',
    });
    await Connection.updateOne({ _id: connectionId, userId: req.userId }, { $set: { lastUsedAt: new Date() } }).catch(() => {});

    return res.status(202).json({
      threadId: String(thread._id),
      investigationId: String(investigation._id),
      status: 'queued',
      connectionId: connectionId ? String(connectionId) : null,
      database,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to create thread');
    return res.status(500).json({ error: 'Failed to create thread', detail: err.message });
  }
}

export async function listThreadsHandler(req, res) {
  try {
    const threads = await Thread.find({ userId: req.userId }).sort({ updated_at: -1 });
    const latest = await Promise.all(
      threads.map(async (t) => {
        const lastMessage = await Message.findOne({ threadId: t._id })
          .sort({ created_at: -1 })
          .select('content created_at');
        const lastRun = await Investigation.findOne({ threadId: t._id })
          .sort({ created_at: -1 })
          .select('status finalAnswer created_at');
        return {
          ...threadPublic(t),
          lastMessage: lastMessage ? { content: lastMessage.content, created_at: lastMessage.created_at } : null,
          lastRun: lastRun ? { status: lastRun.status, finalAnswer: lastRun.finalAnswer, created_at: lastRun.created_at } : null,
        };
      })
    );
    return res.json(latest);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list threads');
    return res.status(500).json({ error: 'Failed to list threads' });
  }
}

export async function getThreadDetailHandler(req, res) {
  try {
    const thread = await Thread.findOne({ _id: req.params.id, userId: req.userId });
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    const [messages, runs, latestRunSteps] = await Promise.all([
      Message.find({ threadId: thread._id }).sort({ created_at: 1 }),
      Investigation.find({ threadId: thread._id }).sort({ created_at: -1 }),
      (async () => {
        const last = await Investigation.findOne({ threadId: thread._id }).sort({ created_at: -1 });
        if (!last) return [];
        return Step.find({ investigationId: last._id }).sort({ created_at: 1 });
      })(),
    ]);
    return res.json({
      ...threadPublic(thread),
      messages: messages.map(messagePublic),
      runs: runs.map(investigationPublic),
      latestRunSteps: latestRunSteps.map((s) => ({
        id: String(s._id),
        type: s.type,
        tool: s.tool,
        input: s.input,
        result: s.result,
        status: s.status,
        durationMs: s.durationMs,
        created_at: s.created_at,
      })),
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to retrieve thread');
    return res.status(500).json({ error: 'Failed to retrieve thread', detail: err.message });
  }
}

export async function addFollowUpMessageHandler(req, res) {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }
  try {
    const thread = await Thread.findOne({ _id: req.params.id, userId: req.userId });
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    const active = await Investigation.exists({ userId: req.userId, status: { $in: ['queued', 'running'] } });
    if (active) {
      return res.status(409).json({ error: 'A follow-up cannot be queued while the current investigation is still running' });
    }
    await Message.create({ userId: req.userId, threadId: thread._id, role: 'user', content: question });
    const investigation = await Investigation.create({
      userId: req.userId,
      threadId: thread._id,
      question,
      status: 'queued',
    });
    if (thread.connectionId) {
      await Connection.updateOne({ _id: thread.connectionId, userId: req.userId }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    }
    return res.status(202).json({ threadId: String(thread._id), investigationId: String(investigation._id), status: 'queued' });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to queue follow-up');
    return res.status(500).json({ error: 'Failed to queue follow-up', detail: err.message });
  }
}

export async function deleteThreadHandler(req, res) {
  try {
    const thread = await Thread.findOne({ _id: req.params.id, userId: req.userId });
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    const investigations = await Investigation.find({ threadId: thread._id }).select('_id');
    const investigationIds = investigations.map((i) => i._id);
    await Step.deleteMany({ investigationId: { $in: investigationIds } });
    await Investigation.deleteMany({ threadId: thread._id });
    await Message.deleteMany({ threadId: thread._id });
    await thread.deleteOne();
    return res.status(204).end();
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to delete thread');
    return res.status(500).json({ error: 'Failed to delete thread', detail: err.message });
  }
}

// Recent thread context (last N messages' assistant answers) used by the local
// agent for follow-up investigations.
export async function getThreadContextHandler(req, res) {
  const turns = Math.max(1, parseInt(req.query.turns || '3', 10) || 3);
  try {
    const thread = await Thread.findOne({ _id: req.params.id, userId: req.userId });
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    const messages = await Message.find({ threadId: thread._id }).sort({ created_at: -1 }).limit(turns * 2);
    const context = messages.reverse().map(messagePublic);
    return res.json({ thread: threadPublic(thread), messages: context });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to load thread context');
    return res.status(500).json({ error: 'Failed to load thread context', detail: err.message });
  }
}
