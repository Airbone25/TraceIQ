import pino from 'pino';
import {
  createConnection,
  listConnections,
  getConnectionRow,
  deleteConnection,
  verifyConnection,
  listDatabasesOnConnection,
} from '../database/connection-store.js';

const logger = pino({ name: 'connections-controller' });

const DATABASE_NAME_RE = /^[A-Za-z0-9_$]+$/;

export async function createConnectionHandler(req, res) {
  const { name, host, port, user, password } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 100) {
    return res.status(400).json({ error: 'name is required (max 100 chars)' });
  }
  if (typeof host !== 'string' || !host.trim() || host.length > 255) {
    return res.status(400).json({ error: 'host is required' });
  }
  if (typeof user !== 'string' || !user.trim() || user.length > 120) {
    return res.status(400).json({ error: 'user is required' });
  }
  if (typeof password !== 'string') {
    return res.status(400).json({ error: 'password is required' });
  }
  const portNum = Number(port) || 3306;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: 'port must be an integer between 1 and 65535' });
  }

  try {
    await verifyConnection({ host: host.trim(), port: portNum, user: user.trim(), password });
  } catch (err) {
    logger.warn({ err: err.message }, 'Connection verification failed');
    return res.status(422).json({ error: `Could not connect to MySQL server: ${err.message}` });
  }

  try {
    const created = await createConnection({
      name: name.trim(),
      host: host.trim(),
      port: portNum,
      user: user.trim(),
      password,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `A connection named "${name}" already exists` });
    }
    logger.error({ err: err.message }, 'Failed to store connection');
    res.status(500).json({ error: 'Failed to store connection' });
  }
}

export async function listConnectionsHandler(_req, res) {
  try {
    const rows = await listConnections();
    res.json(rows);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list connections');
    res.status(500).json({ error: 'Failed to list connections' });
  }
}

export async function deleteConnectionHandler(req, res) {
  try {
    const deleted = await deleteConnection(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    res.status(204).end();
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to delete connection');
    res.status(500).json({ error: 'Failed to delete connection' });
  }
}

export async function listDatabasesHandler(req, res) {
  try {
    const row = await getConnectionRow(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    const databases = await listDatabasesOnConnection(req.params.id);
    res.json({ databases });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list databases');
    res.status(502).json({ error: `Could not reach MySQL server: ${err.message}` });
  }
}

export function validateDatabaseName(name) {
  return typeof name === 'string' && name.length <= 64 && DATABASE_NAME_RE.test(name);
}
