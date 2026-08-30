import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { User, GroqKey, Connection, Thread, Message, Investigation, Step } from './collections/index.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';

const BCRYPT_ROUNDS = 10;
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export function generateUserId() {
  return crypto.randomUUID();
}

// Map a Mongo user document to the snake_case row shape the rest of the app
// expects, keeping callers (auth/settings controllers) unchanged.
function toUserRow(doc, includeHash = false) {
  if (!doc) return null;
  const row = {
    id: String(doc._id),
    email: doc.email,
    groq_configured: doc.groqConfigured,
    created_at: doc.created_at,
  };
  if (includeHash) row.password_hash = doc.passwordHash;
  return row;
}

export async function createUser({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const doc = await User.create({ email: normalizedEmail, passwordHash });
  return { id: String(doc._id), email: normalizedEmail };
}

export async function getUserByEmail(email) {
  const doc = await User.findOne({ email: email.trim().toLowerCase() });
  return toUserRow(doc, true);
}

export async function getUserById(id) {
  const doc = await User.findById(id);
  return toUserRow(doc, false);
}

export async function getUserGroqConfig(id) {
  const key = await GroqKey.findOne({ userId: id, active: true });
  if (!key || !key.apiKeyEnc) {
    return { apiKey: null, model: DEFAULT_MODEL, configured: false };
  }
  let plain = null;
  try {
    plain = decryptSecret(key.apiKeyEnc);
  } catch {
    plain = null;
  }
  return {
    apiKey: plain,
    model: key.model || DEFAULT_MODEL,
    configured: Boolean(plain),
  };
}

export async function setUserGroqConfig(id, { apiKey, model }) {
  const updates = {};
  if (apiKey != null && String(apiKey).trim() !== '') {
    updates.apiKeyEnc = encryptSecret(String(apiKey).trim());
  }
  if (model != null && String(model).trim() !== '') {
    updates.model = String(model).trim();
  }

  let key = await GroqKey.findOne({ userId: id, name: 'default' });
  if (!key) {
    key = await GroqKey.create({ userId: id, name: 'default', active: true });
  }
  if (updates.apiKeyEnc) key.apiKeyEnc = updates.apiKeyEnc;
  if (updates.model) key.model = updates.model;
  key.active = true;
  await key.save();

  await User.updateOne({ _id: id }, { $set: { groqConfigured: true } });

  let plain = null;
  try {
    plain = updates.apiKeyEnc ? String(apiKey).trim() : key.apiKeyEnc ? decryptSecret(key.apiKeyEnc) : null;
  } catch {
    plain = null;
  }
  return { configured: true, hasKey: Boolean(plain), model: key.model || DEFAULT_MODEL };
}

export async function verifyPassword(plainText, passwordHash) {
  return bcrypt.compare(plainText, passwordHash);
}

export async function updateUserEmail(id, newEmail) {
  const normalized = newEmail.trim().toLowerCase();
  await User.updateOne({ _id: id }, { $set: { email: normalized } });
  return { id, email: normalized };
}

export async function updateUserPassword(id, newPassword) {
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await User.updateOne({ _id: id }, { $set: { passwordHash: hash } });
}

export async function deleteUser(id) {
  const investigations = await Investigation.find({ userId: id }).select('_id');
  await Step.deleteMany({ investigationId: { $in: investigations.map(i => i._id) } });
  await Investigation.deleteMany({ userId: id });
  await Message.deleteMany({ userId: id });
  await Thread.deleteMany({ userId: id });
  await Connection.deleteMany({ userId: id });
  await GroqKey.deleteMany({ userId: id });
  const result = await User.deleteOne({ _id: id });
  return result;
}

export async function getUserCount() {
  return User.countDocuments();
}
