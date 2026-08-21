import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  default: {
    APP_SECRET: 'a'.repeat(64),
    MAX_QUERY_TIMEOUT_MS: 30000,
  },
}));

import { encryptSecret, decryptSecret } from '../utils/crypto.js';

describe('Credential Encryption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should roundtrip a secret', () => {
    const payload = encryptSecret('my_mysql_password');
    expect(payload).not.toContain('my_mysql_password');
    expect(decryptSecret(payload)).toBe('my_mysql_password');
  });

  it('should produce unique ciphertexts for the same plaintext', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
  });

  it('should fail when ciphertext is tampered with', () => {
    const payload = encryptSecret('secret');
    const parts = payload.split(':');
    parts[2] = Buffer.from('tampered-data').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('should reject unsupported ciphertext versions', () => {
    expect(() => decryptSecret('v9:x:y:z')).toThrow('Unsupported ciphertext format');
  });
});
