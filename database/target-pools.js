import mysql from 'mysql2/promise';
import pino from 'pino';
import env from '../config/env.js';

const logger = pino({ name: 'target-pools' });

const IDLE_TTL_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

const pools = new Map();

function sweep() {
  const now = Date.now();
  for (const [key, entry] of pools) {
    if (now - entry.lastUsed > IDLE_TTL_MS) {
      pools.delete(key);
      entry.pool.end().catch(() => {});
      logger.info({ key: key.replace(/:[^:]*$/, ':***') }, 'Idle target pool closed');
    }
  }
}

const sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

export function getTargetPool({ connectionId, database, host, port, user, password }) {
  const key = `${connectionId}:${database}`;
  let entry = pools.get(key);
  if (!entry) {
    const pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 10000,
    });
    entry = { pool, lastUsed: Date.now() };
    pools.set(key, entry);
    logger.info({ key: key.replace(/:[^:]*$/, ':***') }, 'Target pool created');
  }
  entry.lastUsed = Date.now();
  return entry.pool;
}

export async function closeTargetPools(connectionId = null) {
  for (const [key, entry] of [...pools]) {
    if (connectionId === null || key.startsWith(`${connectionId}:`)) {
      pools.delete(key);
      await entry.pool.end().catch(() => {});
    }
  }
}

export async function targetQuery(pool, sql, params = []) {
  const start = Date.now();
  const timeoutMs = env.MAX_QUERY_TIMEOUT_MS || 30000;
  const [rows] = await pool.execute({ sql, timeout: timeoutMs }, params);
  logger.debug({ sql: sql.substring(0, 200), duration: Date.now() - start, rowCount: rows.length }, 'Target query executed');
  return rows;
}

export async function targetRawQuery(pool, sql) {
  const [rows] = await pool.query(sql);
  return rows;
}

export function makeExecutor(pool) {
  return {
    query: (sql, params = []) => targetQuery(pool, sql, params),
    rawQuery: (sql) => targetRawQuery(pool, sql),
  };
}

export function __resetTargetPoolsForTests() {
  for (const [, entry] of pools) {
    entry.pool.end().catch(() => {});
  }
  pools.clear();
}
