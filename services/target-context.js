import pino from 'pino';
import { getConnectionCredentials } from '../database/connection-store.js';
import { getTargetPool, makeExecutor } from '../database/target-pools.js';

const logger = pino({ name: 'target-context' });

export async function resolveExecutionContext({ connectionId, database }) {
  if (!connectionId || !database) {
    throw new Error('An investigation must be bound to a user-selected connection and database');
  }
  const creds = await getConnectionCredentials(connectionId);
  if (!creds) {
    throw new Error(`Connection ${connectionId} not found`);
  }
  const pool = getTargetPool({
    connectionId,
    database,
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
  });
  logger.info({ connectionId, database }, 'Execution context resolved');
  return { exec: makeExecutor(pool) };
}
