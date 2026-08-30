import pino from 'pino';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Connection } from './collections/index.js';
import { closeTargetPools } from './target-pools.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = pino({ name: 'connection-store' });

export const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
export const SAMPLE_DATABASE_NAME = process.env.SAMPLE_DATABASE_NAME || 'traceiq_sample';

// Saved-connection metadata lives in MongoDB (encrypted password at rest).

function toLocalRow(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    host: doc.host,
    port: doc.port,
    user: doc.user,
    useSsl: doc.useSsl,
    last_used_at: doc.lastUsedAt || null,
    created_at: doc.created_at,
  };
}

function decryptedCreds(doc) {
  return {
    id: String(doc._id),
    host: doc.host,
    port: doc.port,
    user: doc.user,
    password: decryptSecret(doc.passwordEnc),
    useSsl: doc.useSsl,
  };
}

export async function createConnection({ name, host, port = 3306, user, password, userId = null }) {
  let doc;
  try {
    doc = await Connection.create({
      userId,
      name,
      host,
      port,
      user,
      passwordEnc: encryptSecret(password),
      useSsl: false,
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw Object.assign(new Error(`A connection named "${name}" already exists`), { code: 'ER_DUP_ENTRY' });
    }
    throw err;
  }
  logger.info({ id: String(doc._id), host, port }, 'Connection registered');
  return { id: String(doc._id), name, host, port, user };
}

export async function listConnections(userId) {
  const docs = await Connection.find({ userId }).sort({ created_at: 1 });
  return docs.map(toLocalRow);
}

export async function touchConnection(id) {
  await Connection.updateOne({ _id: id }, { $set: { lastUsedAt: new Date() } });
}

// Runs a Mongoose query, mapping a CastError (e.g. a malformed id from a route
// parameter) to `null`/`false` ("not found") instead of a thrown 500.
async function safeQuery(run, onNull) {
  try {
    return await run();
  } catch (err) {
    if (err && err.name === 'CastError') return onNull;
    throw err;
  }
}

export async function getConnectionRow(id, userId = null) {
  const doc = await safeQuery(() =>
    userId
      ? Connection.findOne({ _id: id, userId })
      : Connection.findById(id),
    null,
  );
  return doc ? toLocalRow(doc) : null;
}

export async function getConnectionCredentials(id, userId = null) {
  const doc = await safeQuery(() =>
    userId
      ? Connection.findOne({ _id: id, userId })
      : Connection.findById(id),
    null,
  );
  return doc ? decryptedCreds(doc) : null;
}

export async function deleteConnection(id, userId = null) {
  const result = await safeQuery(() =>
    userId
      ? Connection.deleteOne({ _id: id, userId })
      : Connection.deleteOne({ _id: id }),
    { deletedCount: 0 },
  );
  if (!result.deletedCount) {
    logger.info({ id }, 'Connection not found for delete');
    return false;
  }
  await closeTargetPools(id);
  logger.info({ id }, 'Connection deleted');
  return true;
}

// ---- Local target MySQL inspection (uses decrypted credentials) ----

function ephemeralSslFor(creds) {
  const sslFlag = process.env.MYSQL_SSL;
  const enabled = sslFlag && (sslFlag.toLowerCase() === 'true' || sslFlag === '1');
  if (!enabled) return undefined;
  if (creds.host === 'localhost' || creds.host === '127.0.0.1') return undefined;
  const rejectRaw = process.env.MYSQL_SSL_REJECT_UNAUTHORIZED;
  const reject = rejectRaw == null || rejectRaw === '' ? true : !(rejectRaw.toLowerCase() === 'false' || rejectRaw === '0');
  return { rejectUnauthorized: reject };
}

async function withEphemeralConnection(creds, fn) {
  const ssl = ephemeralSslFor(creds);
  const conn = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
    connectTimeout: 10000,
    ...(ssl ? { ssl } : {}),
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => {});
  }
}

export async function verifyConnection(creds) {
  await withEphemeralConnection(creds, async (conn) => {
    await conn.query('SELECT 1');
  });
  return true;
}

export async function listDatabasesOnConnection(id, userId = null) {
  const creds = await getConnectionCredentials(id, userId);
  if (!creds) return null;
  const rows = await withEphemeralConnection(creds, (conn) => conn.query('SHOW DATABASES'));
  return rows[0]
    .map(r => Object.values(r)[0])
    .filter(name => !SYSTEM_DATABASES.has(name));
}

export async function checkConnectionHealth(id, userId = null) {
  const creds = await getConnectionCredentials(id, userId).catch(() => null);
  if (!creds) return { id, healthy: false, latencyMs: null, error: 'Connection not found' };
  const started = Date.now();
  try {
    await withEphemeralConnection(creds, async (conn) => {
      await conn.query('SELECT 1');
    });
    return { id, healthy: true, latencyMs: Date.now() - started, error: null };
  } catch (err) {
    return { id, healthy: false, latencyMs: Date.now() - started, error: err.message };
  }
}

export async function listConnectionSchema(id, database = null, userId = null) {
  const creds = await getConnectionCredentials(id, userId);
  if (!creds) return null;
  return withEphemeralConnection(creds, async (conn) => {
    const [cols] = await conn.query(
      `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE ${database ? 'TABLE_SCHEMA = ?' : 'TABLE_SCHEMA NOT IN (?, ?, ?, ?)'}
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
      database ? [database] : [...SYSTEM_DATABASES]
    );
    const tables = new Map();
    for (const c of cols) {
      const key = c.TABLE_SCHEMA + '.' + c.TABLE_NAME;
      if (!tables.has(key)) tables.set(key, { schema: c.TABLE_SCHEMA, name: c.TABLE_NAME, columns: [] });
      tables.get(key).columns.push({
        name: c.COLUMN_NAME,
        type: c.COLUMN_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
        key: c.COLUMN_KEY,
      });
    }
    return { database, tables: [...tables.values()] };
  });
}

const SAMPLE_SCHEMA_FILE = join(__dirname, '..', 'sql', 'sample-dataset.sql');

export function getSampleDatabaseName() {
  return SAMPLE_DATABASE_NAME;
}

export async function provisionSampleDataset(id, userId = null) {
  const creds = await getConnectionCredentials(id, userId);
  if (!creds) return { ok: false, error: 'Connection not found' };
  const sql = readFileSync(SAMPLE_SCHEMA_FILE, 'utf-8');
  await withEphemeralConnection(creds, async (conn) => {
    for (const stmt of sql.split(';').filter(s => s.trim())) {
      if (stmt.trim()) {
        await conn.query(stmt);
      }
    }
  });
  return { ok: true, database: SAMPLE_DATABASE_NAME };
}
