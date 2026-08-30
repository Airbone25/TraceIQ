// One-time migration: move TraceIQ metadata out of MySQL into MongoDB (the
// cloud store). Reads the old MySQL metadata tables and writes to Mongo via the
// cloud package's own models, handling credential re-encryption:
//
//   - users.password_hash      -> User.passwordHash   (bcrypt hash preserved)
//   - users.groq_api_key       -> GroqKey.apiKeyEnc   (encrypted w/ cloud key)
//   - db_connections.password_enc -> Connection.passwordEnc
//                                (decrypt w/ OLD app APP_SECRET, re-encrypt w/ cloud key)
//   - threads/messages/investigations/steps -> mapped collections
//
// Credentials are never left in plaintext. Idempotent (skips existing users by
// email, connections by userId+name) and dry-run capable with --dry.
//
// Usage (from cloud/):
//   npm run migrate:dry     # preview
//   npm run migrate         # apply
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import env from '../src/env.js';
import { connectDb, closeDb } from '../src/db.js';
import { encryptSecret } from '../src/utils/crypto.js';
import { User } from '../src/models/user.model.js';
import { GroqKey } from '../src/models/groqKey.model.js';
import { Connection } from '../src/models/connection.model.js';
import { Thread } from '../src/models/thread.model.js';
import { Message } from '../src/models/message.model.js';
import { Investigation } from '../src/models/investigation.model.js';
import { Step } from '../src/models/step.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OLD_ENV_PATH = path.resolve(PROJECT_ROOT, '..', '.env');

const DRY = process.argv.includes('--dry');

// ---- minimal .env parser (no external dep beyond what's present) ----
function loadEnv(file) {
  const out = {};
  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Decrypt a v1:iv:data:tag AES-256-GCM ciphertext with an explicit hex key
// (mirrors the desktop app's utils/crypto.js but with the OLD app secret).
function decryptOldSecret(payload, secretHex) {
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unsupported old ciphertext format');
  const key = Buffer.from(secretHex, 'hex');
  if (key.length !== 32) throw new Error('OLD APP_SECRET must be 64 hex chars');
  const [, ivB64, dataB64, tagB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

const oldEnv = loadEnv(OLD_ENV_PATH);
const oldSecret = oldEnv.APP_SECRET;
if (!oldSecret) {
  console.error('[migrate] OLD APP_SECRET not found in', OLD_ENV_PATH);
  process.exit(1);
}

const oldMy = {
  host: oldEnv.MYSQL_HOST || 'localhost',
  port: Number(oldEnv.MYSQL_PORT) || 3306,
  user: oldEnv.MYSQL_USER || 'root',
  password: oldEnv.MYSQL_PASSWORD || '',
  database: oldEnv.MYSQL_DATABASE || 'traceiq',
};

let applied = 0;
let skipped = 0;

function note(action, detail) {
  if (DRY) console.log(`  [dry] ${action}: ${detail}`);
  else {
    console.log(`  [ok]  ${action}: ${detail}`);
    applied += 1;
  }
}

async function rowFrom(conn, table) {
  const [rows] = await conn.query(`SELECT * FROM ${table}`);
  return rows;
}

async function main() {
  console.log(`[migrate] source MySQL: ${oldMy.user}@${oldMy.host}:${oldMy.port}/${oldMy.database}`);
  console.log(`[migrate] target Mongo : ${env.MONGODB_URI}`);
  console.log(DRY ? '[migrate] DRY RUN - no changes will be written' : '[migrate] APPLYING');

  const mongo = await connectDb();

  const oldConn = await mysql.createConnection({
    host: oldMy.host,
    port: oldMy.port,
    user: oldMy.user,
    password: oldMy.password,
    database: oldMy.database,
  });

  // ---- users + groq keys ----
  const users = await rowFrom(oldConn, 'users');
  console.log(`[migrate] ${users.length} user(s) found`);

  const userIdByEmail = new Map();
  for (const u of users) {
    const existing = await User.findOne({ email: u.email.toLowerCase() }).lean();
    if (existing) {
      skipped += 1;
      console.log(`  [skip] user ${u.email} already present`);
      userIdByEmail.set(u.email.toLowerCase(), existing._id);
      continue;
    }
    const created = await User.create({ email: u.email, passwordHash: u.password_hash, groqConfigured: u.groq_configured === 1 });
    note('user', u.email);
    userIdByEmail.set(u.email.toLowerCase(), created._id);

    if (u.groq_api_key && String(u.groq_api_key).trim()) {
      await GroqKey.create({
        userId: created._id,
        name: 'default',
        apiKeyEnc: encryptSecret(String(u.groq_api_key).trim()),
        model: u.groq_model || null,
        active: true,
      });
      note('groq key', `${u.email} (encrypted, model=${u.groq_model || 'default'})`);
    }
  }

  // ---- connections ----
  const conns = await rowFrom(oldConn, 'db_connections');
  console.log(`[migrate] ${conns.length} connection(s) found`);
  const connIdByOldId = new Map();
  for (const c of conns) {
    const ownerEmail = ((c.user_id && users.find((x) => x.id === c.user_id)) || {}).email;
    const user = ownerEmail ? userIdByEmail.get(String(ownerEmail).toLowerCase()) : null;
    if (!user) {
      skipped += 1;
      console.log(`  [skip] connection "${c.name}" has no migrated owner`);
      continue;
    }
    const exists = await Connection.findOne({ userId: user, name: c.name }).lean();
    if (exists) {
      skipped += 1;
      console.log(`  [skip] connection "${c.name}" already present`);
      connIdByOldId.set(c.id, exists._id);
      continue;
    }
    let plainPw;
    try {
      plainPw = decryptOldSecret(c.password_enc, oldSecret);
    } catch (err) {
      skipped += 1;
      console.log(`  [skip] connection "${c.name}": cannot decrypt old password (${err.message})`);
      continue;
    }
    const created = await Connection.create({
      userId: user,
      name: c.name,
      host: c.host,
      port: c.port,
      user: c.db_user,
      passwordEnc: encryptSecret(plainPw),
      useSsl: false,
      lastUsedAt: c.last_used_at || null,
    });
    note('connection', `${c.name} (${c.host}:${c.port}, user=${c.db_user})`);
    connIdByOldId.set(c.id, created._id);
  }

  // ---- threads / messages / investigations / steps ----
  const threads = await rowFrom(oldConn, 'investigation_threads');
  console.log(`[migrate] ${threads.length} thread(s) found`);
  const threadIdByOldId = new Map();
  for (const t of threads) {
    const ownerEmail = ((t.user_id && users.find((x) => x.id === t.user_id)) || {}).email;
    const user = ownerEmail ? userIdByEmail.get(String(ownerEmail).toLowerCase()) : null;
    if (!user) {
      skipped += 1;
      console.log(`  [skip] thread "${t.title}" has no migrated owner`);
      continue;
    }
    const createdThread = await Thread.create({
      userId: user,
      title: t.title || 'New investigation',
      connectionId: null,
      database: null,
      created_at: t.created_at,
      updated_at: t.updated_at,
    });
    note('thread', t.title || t.id);
    threadIdByOldId.set(t.id, createdThread._id);
  }

  const investigations = await rowFrom(oldConn, 'investigations');
  console.log(`[migrate] ${investigations.length} investigation(s) found`);
  const invIdByOldId = new Map();
  for (const iv of investigations) {
    const ownerEmail = ((iv.user_id && users.find((x) => x.id === iv.user_id)) || {}).email;
    const user = ownerEmail ? userIdByEmail.get(String(ownerEmail).toLowerCase()) : null;
    if (!user) continue;
    const threadId = iv.thread_id ? threadIdByOldId.get(iv.thread_id) || null : null;
    const status = iv.status === 'running' ? 'running' : iv.status === 'failed' ? 'failed' : 'completed';
    const createdInv = await Investigation.create({
      userId: user,
      threadId,
      question: iv.question,
      status,
      finalAnswer: iv.final_answer || null,
      error: iv.error || null,
      steps: iv.steps || 0,
      sqlQueries: iv.sql_queries || 0,
      llmCalls: 0,
      llmDurationMs: 0,
      toolDurationMs: 0,
      totalDurationMs: iv.duration_ms || 0,
      created_at: iv.created_at,
      updated_at: iv.completed_at || iv.created_at,
    });
    note('investigation', (iv.question || '').slice(0, 40));
    invIdByOldId.set(iv.id, createdInv._id);
  }

  const messages = await rowFrom(oldConn, 'investigation_messages');
  console.log(`[migrate] ${messages.length} message(s) found`);
  for (const m of messages) {
    const threadId = threadIdByOldId.get(m.thread_id);
    if (!threadId) continue;
    const owner = await Thread.findById(threadId).select('userId').lean().catch(() => null);
    await Message.create({
      userId: owner ? owner.userId : (userIdByEmail.values().next().value || null),
      threadId,
      role: m.role,
      content: m.content,
    });
    note('message', m.role);
  }

  const steps = await rowFrom(oldConn, 'investigation_steps');
  console.log(`[migrate] ${steps.length} step(s) found`);
  for (const s of steps) {
    const invId = invIdByOldId.get(s.investigation_id);
    if (!invId) continue;
    const owner = await Investigation.findById(invId).select('userId').lean().catch(() => null);
    await Step.create({
      investigationId: invId,
      userId: owner ? owner.userId : (userIdByEmail.values().next().value || null),
      type: 'tool',
      tool: s.tool_name,
      input: s.tool_input,
      result: s.tool_output,
      status: 'completed',
      durationMs: s.duration_ms || 0,
    });
    note('step', `#${s.step_number} ${s.tool_name}`);
  }

  await oldConn.end();
  await closeDb();

  console.log(``);
  console.log('[migrate] done.');
  if (DRY) console.log('[migrate] dry run - nothing was written.');
  console.log(`[migrate] applied=${applied} skipped=${skipped}`);
  void mongo;
}

main().catch(async (err) => {
  console.error('[migrate] FAILED:', err && err.stack || err);
  await closeDb().catch(() => {});
  process.exit(1);
});
