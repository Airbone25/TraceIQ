import crypto from 'crypto';
import env from '../env.js';

function secretKey() {
  return Buffer.from(env.DATA_ENCRYPTION_KEY, 'hex');
}

// Encrypt a plaintext string to a self-describing payload: v1:<iv>:<cipher>:<tag>.
export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptSecret(payload) {
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported ciphertext format');
  }
  const [, ivB64, dataB64, tagB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
