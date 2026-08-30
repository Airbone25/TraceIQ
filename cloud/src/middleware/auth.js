import jwt from 'jsonwebtoken';
import env from '../env.js';

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET);
  return payload.sub;
}

// Extracts the JWT from the Authorization: Bearer <token> header.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.userId = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}
