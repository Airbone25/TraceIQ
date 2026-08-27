import crypto from 'crypto';
import pino from 'pino';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from './mysql.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { closeTargetPools } from './target-pools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = pino({ name: 'connection-store' });

export const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
export const SAMPLE_DATABASE_NAME = process.env.SAMPLE_DATABASE_NAME || 'traceiq_sample';

export function generateConnectionId() {
  return crypto.randomUUID();
}

export async function createConnection({ name, host, port = 3306, user, password, userId = null }) {
  const id = generateConnectionId();
  await query(
    'INSERT INTO db_connections (id, name, host, port, db_user, password_enc, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, name, host, port, user, encryptSecret(password), userId]
  );
  logger.info({ id, host, port }, 'Connection registered');
  return { id, name, host, port, user };
}

export async function listConnections(userId) {
  return query(
    'SELECT id, name, host, port, db_user AS user, last_used_at, created_at FROM db_connections WHERE user_id = ? ORDER BY created_at ASC',
    [userId]
  );
}

export async function touchConnection(id) {
  await query('UPDATE db_connections SET last_used_at = NOW() WHERE id = ?', [id]);
}

export async function getConnectionRow(id, userId = null) {
  const rows = await query(
    'SELECT * FROM db_connections WHERE id = ?' + (userId ? ' AND user_id = ?' : ''),
    userId ? [id, userId] : [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function getConnectionCredentials(id, userId = null) {
  const row = await getConnectionRow(id, userId);
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    user: row.db_user,
    password: decryptSecret(row.password_enc),
  };
}

export async function deleteConnection(id, userId = null) {
  const result = await query(
    'DELETE FROM db_connections WHERE id = ?' + (userId ? ' AND user_id = ?' : ''),
    userId ? [id, userId] : [id]
  );
  if (result.affectedRows > 0) {
    await closeTargetPools(id);
    logger.info({ id }, 'Connection deleted');
    return true;
  }
  return false;
}

async function withEphemeralConnection(creds, fn) {
  const conn = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
    connectTimeout: 10000,
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
  const creds = await getConnectionCredentials(id, userId);
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
