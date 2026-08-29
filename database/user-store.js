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

export async function updateUserEmail(id, newEmail) {
  const normalized = newEmail.trim().toLowerCase();
  await query('UPDATE users SET email = ? WHERE id = ?', [normalized, id]);
  return { id, email: normalized };
}

export async function updateUserPassword(id, newPassword) {
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
}

export async function deleteUser(id) {
  // cascade deletes: investigation_steps -> investigations -> threads/messages + connections
  // Delete steps via investigations
  await query('DELETE FROM investigation_steps WHERE investigation_id IN (SELECT id FROM investigations WHERE user_id = ?)', [id]);
  await query('DELETE FROM investigations WHERE user_id = ?', [id]);
  await query('DELETE FROM investigation_messages WHERE thread_id IN (SELECT id FROM investigation_threads WHERE user_id = ?)', [id]);
  await query('DELETE FROM investigation_threads WHERE user_id = ?', [id]);
  await query('DELETE FROM db_connections WHERE user_id = ?', [id]);
  const result = await query('DELETE FROM users WHERE id = ?', [id]);
  return result;
}

export async function getUserCount() {
  const rows = await query('SELECT COUNT(*) as cnt FROM users');
  return rows[0]?.cnt ?? 0;
}
