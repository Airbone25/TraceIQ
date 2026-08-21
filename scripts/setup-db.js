import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = pino({ name: 'setup-db' });

const config = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
};

const dbName = process.env.MYSQL_DATABASE || 'traceiq';

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [dbName, table, column]
  );
  return rows[0].cnt > 0;
}

async function migrate(conn) {
  if (!(await columnExists(conn, 'investigations', 'thread_id'))) {
    await conn.execute(
      'ALTER TABLE investigations ADD COLUMN thread_id VARCHAR(36) NULL AFTER id, ADD INDEX idx_investigations_thread (thread_id)'
    );
    logger.info('Migration applied: investigations.thread_id');
  }
  if (!(await columnExists(conn, 'investigation_threads', 'connection_id'))) {
    await conn.execute(
      'ALTER TABLE investigation_threads ADD COLUMN connection_id VARCHAR(36) NULL AFTER title, ADD COLUMN target_database VARCHAR(64) NULL AFTER connection_id'
    );
    logger.info('Migration applied: investigation_threads.connection_id + target_database');
  }
}

async function setup() {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    logger.info('Connected to MySQL');

    await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    logger.info({ database: dbName }, 'Database created/verified');

    await conn.changeUser({ database: dbName });

    const schema = readFileSync(join(__dirname, '..', 'sql', 'schema.sql'), 'utf-8');
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        await conn.execute(stmt);
      }
    }
    logger.info('Schema applied successfully');

    await migrate(conn);
    logger.info('Setup complete');
  } catch (err) {
    logger.error({ err: err.message }, 'Setup failed');
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

setup();
