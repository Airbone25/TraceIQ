import pino from 'pino';
import { createUser, getUserByEmail, getUserById, verifyPassword } from '../database/user-store.js';
import { signAuthToken } from '../services/jwt.js';

const logger = pino({ name: 'auth-controller' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authBodyFromUser(user) {
  return {
    token: signAuthToken({ userId: user.id }),
    id: user.id,
    email: user.email,
    groqConfigured: Boolean(user.groq_configured),
    created_at: user.created_at || null,
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
    const user = await createUser({ email, password });
    logger.info({ userId: user.id }, 'User registered');
    return res.status(201).json(authBodyFromUser(user));
  } catch (err) {
    if (err?.code === 11000 || /E11000|dup/.test(err?.message || '')) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    logger.error({ err: err.message }, 'Registration failed');
    return res.status(500).json({ error: err.message });
  }
}

export async function loginHandler(req, res) {
  const email = req.body?.email?.trim();
  const password = req.body?.password;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = await getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  logger.info({ userId: user.id }, 'User logged in');
  return res.json(authBodyFromUser(user));
}

export async function logoutHandler(_req, res) {
  return res.json({ ok: true });
}

export async function meHandler(req, res) {
  const user = await getUserById(req.userId);
  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
  return res.json({
    id: user.id,
    email: user.email,
    groqConfigured: Boolean(user.groq_configured),
    created_at: user.created_at || null,
  });
}
