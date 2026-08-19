import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = pino({ name: 'seed-db' });

const config = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'traceiq',
};

async function seed() {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    logger.info('Connected to MySQL');

    const seed = readFileSync(join(__dirname, '..', 'sql', 'seed.sql'), 'utf-8');
    const statements = seed.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        await conn.execute(stmt);
      }
    }
    logger.info('Seed data inserted successfully');
  } catch (err) {
    logger.error({ err: err.message }, 'Seed failed');
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

seed();
