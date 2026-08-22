import jwt from 'jsonwebtoken';
import env from '../config/env.js';

export const SESSION_COOKIE = 'tq_session';

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function signSessionToken(userId) {
  return jwt.sign({ sub: userId }, env.APP_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

export function verifySessionToken(token) {
  const payload = jwt.verify(token, env.APP_SECRET);
  return payload.sub;
}

export function setSessionCookie(res, userId) {
  res.cookie(SESSION_COOKIE, signSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.userId = verifySessionToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}
