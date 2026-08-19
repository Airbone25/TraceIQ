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
    logger.info('Setup complete');
  } catch (err) {
    logger.error({ err: err.message }, 'Setup failed');
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

setup();
