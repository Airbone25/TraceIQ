import pino from 'pino';
import {
  createUser,
  getUserByEmail,
  getUserById,
  verifyPassword,
} from '../database/user-store.js';
import { setSessionCookie, clearSessionCookie } from '../middleware/auth.js';

const logger = pino({ name: 'auth-controller' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegistration(body) {
  const email = body?.email?.trim();
  const password = body?.password;
  if (!email || !EMAIL_RE.test(email)) {
    return { error: 'A valid email address is required' };
  }
  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }
  return null;
}

export async function registerHandler(req, res) {
  const error = validateRegistration(req.body);
  if (error) return res.status(400).json(error);

  const email = req.body.email.trim().toLowerCase();

  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const user = await createUser({ email, password: req.body.password });
    setSessionCookie(res, user.id);
    logger.info({ userId: user.id }, 'User registered');
    res.status(201).json(user);
  } catch (err) {
    logger.error({ err: err.message }, 'Registration failed');
    res.status(500).json({ error: 'Failed to create account', detail: err.message });
  }
}

export async function loginHandler(req, res) {
  const email = req.body?.email?.trim();
  const password = req.body?.password;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await getUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    setSessionCookie(res, user.id);
    res.json({ id: user.id, email: user.email });
  } catch (err) {
    logger.error({ err: err.message }, 'Login failed');
    res.status(500).json({ error: 'Login failed', detail: err.message });
  }
}

export async function logoutHandler(req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}

export async function meHandler(req, res) {
  try {
    const user = await getUserById(req.userId);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    res.json({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      groqConfigured: Number(user.groq_configured) === 1,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to load session user');
    res.status(500).json({ error: 'Failed to load account', detail: err.message });
  }
}
