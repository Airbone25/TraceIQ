import { GroqKey } from '../models/groqKey.model.js';
import { User } from '../models/user.model.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

function maskKey(plain) {
  if (!plain) return null;
  return `••••••••${plain.slice(-4)}`;
}

function toPublic(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    model: doc.model || DEFAULT_MODEL,
    active: doc.active,
    createdAt: doc.createdAt,
  };
}

export async function getGroqStatus(userId) {
  const activeKey = await GroqKey.findOne({ userId, active: true });
  if (!activeKey || !activeKey.apiKeyEnc) {
    return { configured: false, hasKey: false, model: DEFAULT_MODEL, masked: null };
  }
  let plain = null;
  try {
    plain = decryptSecret(activeKey.apiKeyEnc);
  } catch {
    plain = null;
  }
  return {
    configured: true,
    hasKey: Boolean(plain),
    model: activeKey.model || DEFAULT_MODEL,
    masked: maskKey(plain),
  };
}

export async function upsertGroqKey(userId, { apiKey, model } = {}) {
  const updates = { userId };
  if (apiKey != null && String(apiKey).trim() !== '') {
    const trimmed = String(apiKey).trim();
    if (trimmed.length < 10) throw new Error('Groq API key looks too short');
    updates.apiKeyEnc = encryptSecret(trimmed);
    updates.active = true;
  }
  if (model != null && String(model).trim() !== '') {
    updates.model = String(model).trim();
  }

  let key = await GroqKey.findOne({ userId, name: 'default' });
  if (!key) {
    key = await GroqKey.create({ userId, name: 'default', active: true });
  }
  if (updates.apiKeyEnc) key.apiKeyEnc = updates.apiKeyEnc;
  if (updates.model) key.model = updates.model;
  key.active = true;
  await key.save();

  await User.updateOne({ _id: userId }, { $set: { groqConfigured: true } });

  const plain = updates.apiKeyEnc
    ? String(apiKey).trim()
    : key.apiKeyEnc
      ? decryptSecret(key.apiKeyEnc)
      : '';
  return {
    configured: true,
    hasKey: Boolean(plain),
    model: key.model || DEFAULT_MODEL,
    masked: maskKey(plain),
  };
}

export async function decryptActiveGroqKey(userId) {
  const key = await GroqKey.findOne({ userId, active: true });
  if (!key || !key.apiKeyEnc) return null;
  return {
    apiKey: decryptSecret(key.apiKeyEnc),
    model: key.model || DEFAULT_MODEL,
  };
}

// Verify a Groq key with a minimal, cheap chat completion. Returns ok plus the model used.
export async function verifyGroqKey(apiKey) {
  const key = String(apiKey == null ? '' : apiKey).trim();
  if (!key) return { ok: false, error: 'No API key provided' };
  const { default: Groq } = await import('groq-sdk');
  const client = new Groq({ apiKey: key });
  try {
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
    const model = completion.model || DEFAULT_MODEL;
    return { ok: true, model };
  } catch (err) {
    logger.warn({ err: err.message }, 'Groq key verification failed');
    return { ok: false, error: err.message };
  }
}
