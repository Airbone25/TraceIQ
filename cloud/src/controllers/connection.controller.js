import { Connection } from '../models/connection.model.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

function toListItem(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    host: doc.host,
    port: doc.port,
    user: doc.user,
    useSsl: doc.useSsl,
    lastUsedAt: doc.lastUsedAt,
    created_at: doc.created_at,
  };
}

const NAME_SLUG_RE = /^[A-Za-z0-9_ -]+$/;

export async function listConnectionsHandler(req, res) {
  try {
    const docs = await Connection.find({ userId: req.userId }).sort({ created_at: 1 });
    return res.json(docs.map(toListItem));
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list connections');
    return res.status(500).json({ error: 'Failed to list connections' });
  }
}

export async function createConnectionHandler(req, res) {
  const { name, host, port, user, password, useSsl } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || !NAME_SLUG_RE.test(name.trim())) {
    return res.status(400).json({ error: 'name is required (letters, numbers, spaces, dashes; max 100)' });
  }
  if (typeof host !== 'string' || !host.trim() || host.length > 255) {
    return res.status(400).json({ error: 'host is required' });
  }
  if (typeof user !== 'string' || !user.trim() || user.length > 120) {
    return res.status(400).json({ error: 'user is required' });
  }
  if (typeof password !== 'string' || password === '') {
    return res.status(400).json({ error: 'password is required' });
  }
  const portNum = Number(port) || 3306;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: 'port must be an integer between 1 and 65535' });
  }

  try {
    const doc = await Connection.create({
      userId: req.userId,
      name: name.trim(),
      host: host.trim(),
      port: portNum,
      user: user.trim(),
      passwordEnc: encryptSecret(password),
      useSsl: Boolean(useSsl),
    });
    return res.status(201).json(toListItem(doc));
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: `A connection named "${name.trim()}" already exists` });
    }
    logger.error({ err: err.message }, 'Failed to store connection');
    return res.status(500).json({ error: 'Failed to store connection' });
  }
}

export async function deleteConnectionHandler(req, res) {
  try {
    const result = await Connection.deleteOne({ _id: req.params.id, userId: req.userId });
    if (!result.deletedCount) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    return res.status(204).end();
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to delete connection');
    return res.status(500).json({ error: 'Failed to delete connection' });
  }
}

export async function touchConnectionHandler(req, res) {
  try {
    await Connection.updateOne({ _id: req.params.id, userId: req.userId }, { $set: { lastUsedAt: new Date() } });
    return res.status(204).end();
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to touch connection');
    return res.status(500).json({ error: 'Failed to touch connection' });
  }
}

// Delivers the decrypted target credentials to the local agent over TLS so it
// can open an ephemeral MySQL pool. Never stored client-side in plaintext.
export async function getConnectionCredentialsHandler(req, res) {
  try {
    const doc = await Connection.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    return res.json({
      id: String(doc._id),
      host: doc.host,
      port: doc.port,
      user: doc.user,
      password: decryptSecret(doc.passwordEnc),
      useSsl: doc.useSsl,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to resolve connection credentials');
    return res.status(500).json({ error: 'Failed to resolve connection credentials' });
  }
}
