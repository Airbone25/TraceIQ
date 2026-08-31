import crypto from 'crypto';
import pino from 'pino';
import env from '../config/env.js';

const logger = pino({ name: 'otp' });

const OTP_DIGITS = 6;

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateOtp() {
  // 6-digit numeric code using a CSPRNG, avoiding modulo bias via rejection sampling.
  const max = 10 ** OTP_DIGITS;
  let value;
  do {
    value = crypto.randomInt(0, 100000000);
  } while (value >= max);
  return String(value).padStart(OTP_DIGITS, '0');
}

// Build a verification record for a user object (persisted as hashed fields).
function buildVerification() {
  const code = generateOtp();
  const ttlMs = (env.EMAIL_OTP_TTL_MIN || 15) * 60 * 1000;
  return {
    code,
    otpCodeHash: hashOtp(code),
    otpExpiresAt: new Date(Date.now() + ttlMs),
    otpAttempts: 0,
    otpResendAt: new Date(),
  };
}

function verifyEmailCode(user, code) {
  if (!user.otpCodeHash || !user.otpExpiresAt) {
    return { ok: false, reason: 'no_code' };
  }
  if (new Date(user.otpExpiresAt) < new Date()) {
    return { ok: false, reason: 'expired' };
  }
  if ((user.otpAttempts || 0) >= (env.EMAIL_OTP_MAX_ATTEMPTS || 5)) {
    return { ok: false, reason: 'too_many_attempts' };
  }
  const provided = hashOtp(code);
  const matches = crypto.timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(String(user.otpCodeHash), 'utf8'),
  );
  if (!matches) {
    logger.info('OTP mismatch');
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, reason: 'verified' };
}

export { generateOtp, hashOtp, buildVerification, verifyEmailCode };
