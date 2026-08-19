import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = pino({ name: 'reset-db' });

const config = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
};

const dbName = process.env.MYSQL_DATABASE || 'traceiq';

async function reset() {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    logger.info('Connected to MySQL');

    await conn.execute(`DROP DATABASE IF EXISTS \`${dbName}\``);
    logger.info({ database: dbName }, 'Database dropped');

    await conn.execute(`CREATE DATABASE \`${dbName}\``);
    logger.info({ database: dbName }, 'Database created');

    await conn.changeUser({ database: dbName });

    const schema = readFileSync(join(__dirname, '..', 'sql', 'schema.sql'), 'utf-8');
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        await conn.execute(stmt);
      }
    }
    logger.info('Schema applied');

    const seed = readFileSync(join(__dirname, '..', 'sql', 'seed.sql'), 'utf-8');
    const seedStatements = seed.split(';').filter(s => s.trim());
    for (const stmt of seedStatements) {
      if (stmt.trim()) {
        await conn.execute(stmt);
      }
    }
    logger.info('Seed data inserted');

    logger.info('Reset complete');
  } catch (err) {
    logger.error({ err: err.message }, 'Reset failed');
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

reset();
