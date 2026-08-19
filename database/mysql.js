import mysql from 'mysql2/promise';
import pino from 'pino';
import env from '../config/env.js';

const logger = pino({ name: 'database' });

let pool = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
    logger.info('Connection pool created');
  }
  return pool;
}

export async function query(sql, params = []) {
  const start = Date.now();
  const [rows] = await getPool().execute(sql, params);
  const duration = Date.now() - start;
  logger.debug({ sql: sql.substring(0, 200), duration, rowCount: rows.length }, 'Query executed');
  return rows;
}

export async function rawQuery(sql) {
  const start = Date.now();
  const [rows] = await getPool().query(sql);
  const duration = Date.now() - start;
  logger.debug({ sql: sql.substring(0, 200), duration, rowCount: rows.length }, 'Raw query executed');
  return rows;
}

export async function testConnection() {
  try {
    const conn = await getPool().getConnection();
    await conn.ping();
    conn.release();
    logger.info('Database connection OK');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Database connection failed');
    return false;
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Connection pool closed');
  }
}
