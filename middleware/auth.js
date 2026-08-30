import { verifyAuthToken } from '../services/jwt.js';

export const SESSION_COOKIE = 'tq_session';

// Local stateless JWT auth. The renderer holds the JWT in localStorage and
// sends it as `Authorization: Bearer <token>`. Tokens are signed with APP_SECRET
// and carry the user's Mongo ObjectId, so verification happens entirely in this
// process (no cloud round-trip).

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (header && header.trim()) return header.trim();
  return null;
}

export async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = verifyAuthToken(token);
    req.userId = String(payload.userId || payload.sub);
    req.userToken = token;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

export async function optionalAuth(req, _res, next) {
  const token = getBearerToken(req);
  if (token) {
    try {
      const payload = verifyAuthToken(token);
      req.userId = String(payload.userId || payload.sub);
      req.userToken = token;
    } catch {
      /* ignore invalid optional token */
    }
  }
  next();
}

// Kept for compatibility with the previous cookie flow; auth is Bearer JWT now.
export async function signSessionToken() {
  return null;
}

export async function verifySessionToken() {
  return null;
}

export function setSessionCookie() {
  /* no-op: auth is Bearer JWT now */
}

export function clearSessionCookie() {
  /* no-op: auth is Bearer JWT now */
}
