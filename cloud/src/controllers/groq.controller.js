import { getGroqStatus, upsertGroqKey, verifyGroqKey } from '../services/groq.service.js';
import { logger } from '../utils/logger.js';

export async function getGroqHandler(req, res) {
  try {
    const status = await getGroqStatus(req.userId);
    return res.json(status);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to load Groq status');
    return res.status(500).json({ error: 'Failed to load Groq settings', detail: err.message });
  }
}

export async function updateGroqHandler(req, res) {
  const { apiKey, model } = req.body || {};
  try {
    const result = await upsertGroqKey(req.userId, { apiKey, model });
    return res.json(result);
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to save Groq settings');
    return res.status(400).json({ error: err.message });
  }
}

export async function verifyGroqHandler(req, res) {
  const { apiKey } = req.body || {};
  const result = await verifyGroqKey(apiKey);
  if (result.ok) return res.json({ ok: true, model: result.model });
  return res.status(400).json({ ok: false, error: result.error });
}
