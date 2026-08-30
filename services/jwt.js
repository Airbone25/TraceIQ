import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

// Local stateless JWT auth. Tokens are signed with APP_SECRET (hex) and carry
// the user's Mongo ObjectId. The renderer stores this token in localStorage and
// sends it back as `Authorization: Bearer <token>`.
const SECRET = () => Buffer.from(env.APP_SECRET, 'hex');

const TOKEN_TTL = '30d';

export function signAuthToken({ userId }) {
  return jwt.sign({ userId: String(userId), sub: String(userId) }, SECRET(), {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });
}

export function verifyAuthToken(token) {
  return jwt.verify(token, SECRET(), { algorithms: ['HS256'] });
}

export function decodeUserId(token) {
  try {
    const payload = verifyAuthToken(token);
    return String(payload.userId || payload.sub);
  } catch {
    return null;
  }
}

export { crypto };
