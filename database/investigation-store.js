import crypto from 'crypto';
import pino from 'pino';
import { Investigation, Step } from './collections/index.js';

const logger = pino({ name: 'investigation-store' });

async function safeQuery(run, onNull) {
  try {
    return await run();
  } catch (err) {
    if (err && err.name === 'CastError') return onNull;
    throw err;
  }
}

export function generateId() {
  return crypto.randomUUID();
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

function mapInvestigation(doc) {
  return {
    id: String(doc._id),
    thread_id: doc.threadId ? String(doc.threadId) : null,
    user_id: String(doc.userId),
    question: doc.question,
    status: doc.status,
    started_at: doc.created_at,
    completed_at: doc.updated_at,
    duration_ms: doc.totalDurationMs ?? doc.durationMs ?? null,
    steps: doc.steps ?? 0,
    sql_queries: doc.sqlQueries ?? 0,
    final_answer: doc.finalAnswer ?? null,
    error: doc.error ?? null,
  };
}

export async function createInvestigation(question, threadId = null, userId = null) {
  const startedAt = new Date();
  const doc = await Investigation.create({ question, threadId, userId, status: 'running' });
  const id = String(doc._id);
  logger.info({ id, threadId, question }, 'Investigation created');
  return { id, startedAt };
}

export async function addStep(investigationId, stepNumber, toolName, toolInput, toolOutput, durationMs) {
  await Step.create({
    investigationId,
    userId: (await Investigation.findById(investigationId).select('userId'))?.userId ?? null,
    stepNumber,
    toolName,
    toolInput: toolInput ?? null,
    toolOutput: toolOutput ?? null,
    durationMs,
  });
}

export async function finalizeInvestigation(investigationId, { status, answer, error, steps, sqlQueries, durationMs }) {
  await Investigation.updateOne(
    { _id: investigationId },
    {
      $set: {
        status,
        finalAnswer: answer || null,
        error: error || null,
        steps,
        sqlQueries,
        totalDurationMs: durationMs ?? null,
      },
    }
  );
  logger.info({ id: investigationId, status }, 'Investigation finalized');
}

export async function getInvestigation(id, userId = null) {
  const doc = await safeQuery(
    () => (userId ? Investigation.findOne({ _id: id, userId }) : Investigation.findById(id)),
    null,
  );
  if (!doc) return null;
  const steps = await Step.find({ investigationId: doc._id }).sort({ stepNumber: 1 });
  return { ...mapInvestigation(doc), steps: steps.map(mapStep) };
}

export async function listInvestigations(userId) {
  const docs = await Investigation.find({ userId }).sort({ created_at: -1 });
  return docs.map(mapInvestigation);
}

export async function failOrphanedInvestigations() {
  const result = await Investigation.updateMany(
    { status: 'running' },
    { $set: { status: 'failed', error: 'Server restarted while investigation was running', updated_at: new Date() } }
  );
  const affected = result?.modifiedCount ?? 0;
  if (affected > 0) {
    logger.warn({ count: affected }, 'Marked orphaned running investigations as failed');
  }
  return affected;
}
