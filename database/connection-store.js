import crypto from 'crypto';
import pino from 'pino';
import mysql from 'mysql2/promise';
import { query } from './mysql.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { closeTargetPools } from './target-pools.js';

const logger = pino({ name: 'connection-store' });

export const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export function generateConnectionId() {
  return crypto.randomUUID();
}

export async function createConnection({ name, host, port = 3306, user, password }) {
  const id = generateConnectionId();
  await query(
    'INSERT INTO db_connections (id, name, host, port, db_user, password_enc) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, host, port, user, encryptSecret(password)]
  );
  logger.info({ id, host, port }, 'Connection registered');
  return { id, name, host, port, user };
}

export async function listConnections() {
  return query('SELECT id, name, host, port, db_user AS user, created_at FROM db_connections ORDER BY created_at ASC');
}

export async function getConnectionRow(id) {
  const rows = await query('SELECT * FROM db_connections WHERE id = ?', [id]);
  return rows.length > 0 ? rows[0] : null;
}

export async function getConnectionCredentials(id) {
  const row = await getConnectionRow(id);
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    user: row.db_user,
    password: decryptSecret(row.password_enc),
  };
}

export async function deleteConnection(id) {
  const result = await query('DELETE FROM db_connections WHERE id = ?', [id]);
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

export async function listDatabasesOnConnection(id) {
  const creds = await getConnectionCredentials(id);
  if (!creds) return null;
  const rows = await withEphemeralConnection(creds, (conn) => conn.query('SHOW DATABASES'));
  return rows[0]
    .map(r => Object.values(r)[0])
    .filter(name => !SYSTEM_DATABASES.has(name));
}
