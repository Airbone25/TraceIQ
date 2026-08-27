import pino from 'pino';
import {
  createConnection,
  listConnections,
  getConnectionRow,
  deleteConnection,
  verifyConnection,
  listDatabasesOnConnection,
  checkConnectionHealth,
  listConnectionSchema,
  provisionSampleDataset,
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
      userId: req.userId,
    });
    res.status(201).json(created);
  } catch (err) {    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `A connection named "${name}" already exists` });
    }
    logger.error({ err: err.message }, 'Failed to store connection');
    res.status(500).json({ error: 'Failed to store connection' });
  }
}

export async function listConnectionsHandler(req, res) {
  try {
    const rows = await listConnections(req.userId);
    res.json(rows);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list connections');
    res.status(500).json({ error: 'Failed to list connections' });
  }
}

export async function deleteConnectionHandler(req, res) {
  try {
    const deleted = await deleteConnection(req.params.id, req.userId);
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
    const row = await getConnectionRow(req.params.id, req.userId);
    if (!row) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    const databases = await listDatabasesOnConnection(req.params.id, req.userId);
    res.json({ databases });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list databases');
    res.status(502).json({ error: `Could not reach MySQL server: ${err.message}` });
  }
}

export async function healthHandler(req, res) {
  try {
    const rows = await listConnections(req.userId);
    const results = await Promise.all(rows.map(r => checkConnectionHealth(r.id, req.userId)));
    res.json({ connections: results.map(r => ({ ...r, name: rows.find(x => x.id === r.id)?.name ?? null })) });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to check connection health');
    res.status(500).json({ error: 'Failed to check connection health' });
  }
}

export async function schemaHandler(req, res) {
  const { id } = req.params;
  const database = typeof req.query.database === 'string' ? req.query.database : null;
  try {
    const row = await getConnectionRow(id, req.userId);
    if (!row) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    const schema = await listConnectionSchema(id, database, req.userId);
    res.json(schema);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list schema');
    res.status(502).json({ error: `Could not reach MySQL server: ${err.message}` });
  }
}

export async function provisionSampleHandler(req, res) {
  const { id } = req.params;
  try {
    const row = await getConnectionRow(id, req.userId);
    if (!row) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    const result = await provisionSampleDataset(id, req.userId);
    if (!result.ok) {
      return res.status(404).json({ error: result.error });
    }
    res.status(201).json({ database: result.database });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to provision sample dataset');
    res.status(502).json({ error: `Could not provision sample dataset: ${err.message}` });
  }
}

export function validateDatabaseName(name) {
  return typeof name === 'string' && name.length <= 64 && DATABASE_NAME_RE.test(name);
}
