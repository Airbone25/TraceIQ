import { getGroqStatus, upsertGroqKey, verifyGroqKey, decryptActiveGroqKey } from '../services/groq.service.js';
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

// Returns the decrypted active Groq key + model so the LOCAL agent can call
// Groq on the user's behalf. Only reachable by an authenticated request; the
// plaintext key must never be sent to a browser-facing endpoint.
export async function getActiveGroqKeyHandler(req, res) {
  try {
    const cfg = await decryptActiveGroqKey(req.userId);
    if (!cfg) return res.status(404).json({ error: 'No Groq key configured' });
    return res.json(cfg);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to load active Groq key');
    return res.status(500).json({ error: 'Failed to load Groq key', detail: err.message });
  }
}
