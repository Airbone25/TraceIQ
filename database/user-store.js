import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from './mysql.js';

const BCRYPT_ROUNDS = 10;

export function generateUserId() {
  return crypto.randomUUID();
}

export async function createUser({ email, password }) {
  const id = generateUserId();
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await query(
    'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
    [id, normalizedEmail, passwordHash]
  );
  return { id, email: normalizedEmail };
}

export async function getUserByEmail(email) {
  const rows = await query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  return rows.length > 0 ? rows[0] : null;
}

export async function getUserById(id) {
  const rows = await query('SELECT id, email, created_at FROM users WHERE id = ?', [id]);
  return rows.length > 0 ? rows[0] : null;
}

export async function verifyPassword(plainText, passwordHash) {
  return bcrypt.compare(plainText, passwordHash);
}
