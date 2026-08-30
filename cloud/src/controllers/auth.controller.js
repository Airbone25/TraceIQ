import bcrypt from 'bcryptjs';
import { User } from '../models/user.model.js';
import { signToken } from '../middleware/auth.js';
import { GroqKey } from '../models/groqKey.model.js';
import { Connection } from '../models/connection.model.js';
import { Thread } from '../models/thread.model.js';
import { Message } from '../models/message.model.js';
import { Investigation } from '../models/investigation.model.js';
import { Step } from '../models/step.model.js';
import { logger } from '../utils/logger.js';

const BCRYPT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(doc) {
  return {
    id: String(doc._id),
    email: doc.email,
    created_at: doc.created_at,
    groqConfigured: Boolean(doc.groqConfigured),
  };
}

export async function registerHandler(req, res) {
  const email = req.body?.email?.trim();
  const password = req.body?.password;
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({ email: email.toLowerCase(), passwordHash });
    const token = signToken(user._id);
    logger.info({ userId: String(user._id) }, 'User registered');
    return res.status(201).json({ ...publicUser(user), token });
  } catch (err) {
    logger.error({ err: err.message }, 'Registration failed');
    return res.status(500).json({ error: 'Failed to create account', detail: err.message });
  }
}

export async function loginHandler(req, res) {
  const email = req.body?.email?.trim();
  const password = req.body?.password;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = signToken(user._id);
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    logger.error({ err: err.message }, 'Login failed');
    return res.status(500).json({ error: 'Login failed', detail: err.message });
  }
}

export async function meHandler(req, res) {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    return res.json(publicUser(user));
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to load session user');
    return res.status(500).json({ error: 'Failed to load account', detail: err.message });
  }
}

export async function logoutHandler(_req, res) {
  // JWT-based flow: the client discards its token. Nothing to invalidate server-side
  // for a stateless JWT; kept for API symmetry with the desktop client.
  return res.status(200).json({ ok: true });
}

export async function deleteAccountHandler(req, res) {
  const userId = req.userId;
  try {
    await Step.deleteMany({ userId });
    await Investigation.deleteMany({ userId });
    await Message.deleteMany({ userId });
    await Thread.deleteMany({ userId });
    await Connection.deleteMany({ userId });
    await GroqKey.deleteMany({ userId });
    await User.deleteOne({ _id: userId });
    return res.status(204).end();
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to delete account');
    return res.status(500).json({ error: 'Failed to delete account', detail: err.message });
  }
}
