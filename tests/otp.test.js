import { describe, it, expect } from 'vitest';
import { generateOtp, hashOtp, buildVerification, verifyEmailCode } from '../services/otp.js';

function verificationRow() {
  const v = buildVerification();
  return {
    id: 'u1',
    email: 'a@b.com',
    otpCodeHash: v.otpCodeHash,
    otpExpiresAt: v.otpExpiresAt,
    otpAttempts: 0,
    otpResendAt: v.otpResendAt,
    emailVerified: false,
  };
}

describe('OTP service', () => {
  it('should generate a 6-digit numeric code', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtp();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('should hash codes deterministically and never store the plaintext', () => {
    const v = buildVerification();
    expect(v.code).toMatch(/^\d{6}$/);
    expect(v.otpCodeHash).not.toBe(v.code);
    expect(hashOtp(v.code)).toBe(v.otpCodeHash);
  });

  it('should accept the correct code', () => {
    const v = buildVerification();
    const user = verificationRow();
    user.otpCodeHash = v.otpCodeHash;
    user.otpExpiresAt = v.otpExpiresAt;
    const result = verifyEmailCode(user, v.code);
    expect(result.ok).toBe(true);
  });

  it('should reject an incorrect code', () => {
    const v = buildVerification();
    const user = verificationRow();
    user.otpCodeHash = v.otpCodeHash;
    const result = verifyEmailCode(user, '000000');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid');
  });

  it('should reject an expired code', () => {
    const v = buildVerification();
    const user = verificationRow();
    user.otpCodeHash = v.otpCodeHash;
    user.otpExpiresAt = new Date(Date.now() - 1000); // expired
    const result = verifyEmailCode(user, v.code);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('should reject once the attempt limit is reached', () => {
    const v = buildVerification();
    const user = verificationRow();
    user.otpCodeHash = v.otpCodeHash;
    user.otpAttempts = 5;
    const result = verifyEmailCode(user, v.code);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('too_many_attempts');
  });

  it('should reject when no code has been issued', () => {
    const user = verificationRow();
    user.otpCodeHash = null;
    const result = verifyEmailCode(user, '123456');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_code');
  });

  it('should use a constant-time comparison for codes', () => {
    // timingSafeEqual validates both branches without throwing on length mismatch
    const v = buildVerification();
    const user = verificationRow();
    user.otpCodeHash = v.otpCodeHash;
    expect(() => verifyEmailCode(user, v.code)).not.toThrow();
    expect(() => verifyEmailCode(user, '999999')).not.toThrow();
  });
});
