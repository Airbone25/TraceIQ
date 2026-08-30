import { Investigation } from '../models/investigation.model.js';
import { Step } from '../models/step.model.js';
import { logger } from '../utils/logger.js';

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
    llmDurationMs: doc.llmDurationMs,
    toolDurationMs: doc.toolDurationMs,
    totalDurationMs: doc.totalDurationMs,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

export async function listAllInvestigationsHandler(req, res) {
  try {
    const docs = await Investigation.find({ userId: req.userId }).sort({ created_at: -1 });
    return res.json(docs.map(investigationPublic));
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list investigations');
    return res.status(500).json({ error: 'Failed to list investigations' });
  }
}

export async function getInvestigationByIdHandler(req, res) {
  try {
    const doc = await Investigation.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) {
      return res.status(404).json({ error: 'Investigation not found' });
    }
    const steps = await Step.find({ investigationId: doc._id }).sort({ created_at: 1 });
    return res.json({
      ...investigationPublic(doc),
      steps: steps.map((s) => ({
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
    logger.error({ err: err.message }, 'Failed to load investigation');
    return res.status(500).json({ error: 'Failed to load investigation', detail: err.message });
  }
}

// Record an agent step. Written by the local agent as it runs.
export async function addStepHandler(req, res) {
  const inv = await Investigation.findOne({ _id: req.params.id, userId: req.userId });
  if (!inv) {
    return res.status(404).json({ error: 'Investigation not found' });
  }
  const { type, tool, input, result, status, durationMs } = req.body || {};
  try {
    const step = await Step.create({
      userId: req.userId,
      investigationId: inv._id,
      type: type || 'tool',
      tool: tool || null,
      input: input ?? null,
      result: result ?? null,
      status: status || 'completed',
      durationMs: durationMs || 0,
    });
    return res.status(201).json({ id: String(step._id) });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to add step');
    return res.status(500).json({ error: 'Failed to add step', detail: err.message });
  }
}

// Advance an investigation status / finalize it.
export async function updateInvestigationHandler(req, res) {
  const inv = await Investigation.findOne({ _id: req.params.id, userId: req.userId });
  if (!inv) {
    return res.status(404).json({ error: 'Investigation not found' });
  }
  const allowed = ['queued', 'running', 'completed', 'failed'];
  const body = req.body || {};
  const patch = {};
  if (body.status != null) {
    if (!allowed.includes(body.status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    patch.status = body.status;
  }
  const numeric = ['steps', 'sqlQueries', 'llmCalls', 'llmDurationMs', 'toolDurationMs', 'totalDurationMs'];
  for (const k of numeric) {
    if (typeof body[k] === 'number' && Number.isFinite(body[k])) patch[k] = body[k];
  }
  if (typeof body.finalAnswer === 'string') patch.finalAnswer = body.finalAnswer;
  if (typeof body.error === 'string') patch.error = body.error;

  try {
    Object.assign(inv, patch);
    await inv.save();
    return res.json(investigationPublic(inv));
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to update investigation');
    return res.status(500).json({ error: 'Failed to update investigation', detail: err.message });
  }
}
