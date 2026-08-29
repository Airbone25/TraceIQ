import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import env from '../config/env.js';
import { resetClient } from '../llm/groq.js';

const logger = pino({ name: 'settings-service' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

function maskKey(value) {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `••••••••${value.slice(-4)}`;
}

export function getGroqStatus() {
  const key = env.GROQ_API_KEY || process.env.GROQ_API_KEY || '';
  return {
    hasKey: Boolean(key && key.trim()),
    masked: key ? maskKey(key) : '',
    keyLength: key ? key.length : 0,
    model: env.GROQ_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    // don't expose full key
  };
}

export function getAppConfig() {
  return {
    groqModel: env.GROQ_MODEL,
    limits: {
      MAX_AGENT_STEPS: env.MAX_AGENT_STEPS,
      MAX_SQL_QUERIES: env.MAX_SQL_QUERIES,
      MAX_QUERY_ROWS: env.MAX_QUERY_ROWS,
      MAX_EXECUTION_TIME_MS: env.MAX_EXECUTION_TIME_MS,
      MAX_QUERY_TIMEOUT_MS: env.MAX_QUERY_TIMEOUT_MS,
      MAX_QUESTION_LENGTH: env.MAX_QUESTION_LENGTH,
      LLM_MAX_TOKENS: env.LLM_MAX_TOKENS,
      MAX_TOOL_RESULT_CHARS: env.MAX_TOOL_RESULT_CHARS,
      MAX_CONTEXT_CHARS: env.MAX_CONTEXT_CHARS,
      MAX_CONCURRENT_INVESTIGATIONS: env.MAX_CONCURRENT_INVESTIGATIONS,
      INVESTIGATION_QUEUE_TIMEOUT_MS: env.INVESTIGATION_QUEUE_TIMEOUT_MS,
      THREAD_CONTEXT_TURNS: env.THREAD_CONTEXT_TURNS,
      THREAD_CONTEXT_ANSWER_CHARS: env.THREAD_CONTEXT_ANSWER_CHARS,
    },
    mysql: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      database: env.MYSQL_DATABASE,
      // never expose password
      hasPassword: Boolean(env.MYSQL_PASSWORD),
    },
  };
}

function parseEnvFile(content) {
  const lines = content.split('\n');
  const map = new Map();
  const order = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      order.push({ type: 'raw', content: line });
      continue;
    }
    const idx = line.indexOf('=');
    if (idx === -1) {
      order.push({ type: 'raw', content: line });
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    map.set(key, value);
    order.push({ type: 'kv', key, value, raw: line });
  }
  return { map, order };
}

function serializeEnv(order, map) {
  const seen = new Set();
  const out = [];
  for (const entry of order) {
    if (entry.type === 'raw') {
      out.push(entry.content);
    } else {
      const val = map.get(entry.key);
      out.push(`${entry.key}=${val}`);
      seen.add(entry.key);
    }
  }
  for (const [k, v] of map.entries()) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  return out.join('\n');
}

export function persistEnvUpdates(updates) {
  // updates: { GROQ_API_KEY, GROQ_MODEL, ... }
  // If .env doesn't exist in production (e.g., desktop mode uses config.json), still update in-memory and skip file.
  let content = '';
  try {
    if (fs.existsSync(ENV_PATH)) {
      content = fs.readFileSync(ENV_PATH, 'utf8');
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Failed to read .env');
  }
  const { map, order } = parseEnvFile(content);
  for (const [k, v] of Object.entries(updates)) {
    if (v == null) continue;
    map.set(k, String(v));
    // if key not in order, it will be appended in serialize
  }
  const nextContent = serializeEnv(order, map);
  try {
    fs.writeFileSync(ENV_PATH, nextContent, 'utf8');
    logger.info({ keys: Object.keys(updates) }, '.env updated');
  } catch (e) {
    logger.warn({ err: e.message }, 'Failed to write .env — in-memory only');
    // don't throw; in-memory still counts
  }
}

export async function updateGroqConfig({ apiKey, model }) {
  const updates = {};
  const envUpdates = {};

  if (typeof apiKey === 'string' && apiKey.trim() !== '') {
    const trimmed = apiKey.trim();
    if (trimmed.length < 10) {
      throw new Error('Groq API key looks too short');
    }
    // basic format check: gsk_ prefix is typical but not enforced strictly
    updates.GROQ_API_KEY = trimmed;
    envUpdates.GROQ_API_KEY = trimmed;
    env.GROQ_API_KEY = trimmed;
    process.env.GROQ_API_KEY = trimmed;
  }

  if (typeof model === 'string' && model.trim() !== '') {
    const trimmedModel = model.trim();
    if (trimmedModel.length > 120) throw new Error('Model name too long');
    updates.GROQ_MODEL = trimmedModel;
    envUpdates.GROQ_MODEL = trimmedModel;
    env.GROQ_MODEL = trimmedModel;
    process.env.GROQ_MODEL = trimmedModel;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No changes provided');
  }

  // Persist to .env where possible
  persistEnvUpdates(updates);

  // Reset groq client so next call uses new key
  try {
    resetClient();
  } catch (e) {
    logger.warn({ err: e.message }, 'Failed to reset Groq client');
  }

  // Optional live validation if key was changed: do a lightweight probe
  // We don't fail the save on validation error, just warn — caller can call /verify separately.
  return getGroqStatus();
}

export async function verifyGroqKey(apiKey) {
  const key = (apiKey || env.GROQ_API_KEY || '').trim();
  if (!key) throw new Error('No API key provided');
  // Do a minimal Groq call: list models or tiny chat. Use Groq SDK directly with override.
  const { default: Groq } = await import('groq-sdk');
  const client = new Groq({ apiKey: key });
  // Use a tiny completion to verify auth; keep it cheap
  try {
    const model = env.GROQ_MODEL || 'openai/gpt-oss-120b';
    // We call with minimal tokens; if key is bad, Groq returns 401
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
    return { ok: true, model };
  } catch (err) {
    const status = err?.status || err?.response?.status;
    if (status === 401) {
      return { ok: false, error: 'Invalid API key (401 Unauthorized)' };
    }
    // For other errors, we surface but don't treat as key invalid necessarily
    return { ok: false, error: err.message || 'Verification failed', status };
  }
}
