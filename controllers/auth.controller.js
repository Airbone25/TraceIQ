import pino from 'pino';
import {
  createUser,
  getUserByEmail,
  getUserById,
  getUserVerification,
  saveUserVerification,
  markEmailVerified,
  incrementOtpAttempts,
  verifyPassword,
} from '../database/user-store.js';
import { signAuthToken } from '../services/jwt.js';
import { buildVerification, verifyEmailCode } from '../services/otp.js';
import { sendOtpEmail } from '../services/email.js';
import env from '../config/env.js';

const logger = pino({ name: 'auth-controller' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authBodyFromUser(user) {
  return {
    token: signAuthToken({ userId: user.id }),
    id: user.id,
    email: user.email,
    groqConfigured: Boolean(user.groq_configured),
    emailVerified: Boolean(user.emailVerified ?? user.email_verified),
    created_at: user.created_at || null,
  };
}

export async function registerHandler(req, res) {
  const email = req.body?.email?.trim();
  const password = req.body?.password;
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const user = await createUser({ email, password });
    // Generate + persist an OTP, then email it. No token is issued until verified.
    const verification = buildVerification();
    await saveUserVerification(user.id, {
      otpCodeHash: verification.otpCodeHash,
      otpExpiresAt: verification.otpExpiresAt,
      otpAttempts: 0,
      otpResendAt: verification.otpResendAt,
    });
    const delivery = await sendOtpEmail({ to: user.email, otp: verification.code });

    logger.info({ userId: user.id, delivery: delivery.sent ? 'sent' : 'dev' }, 'User registered; OTP generated');
    return res.status(201).json({
      id: user.id,
      email: user.email,
      emailVerified: false,
      requiresVerification: true,
      delivery: { dev: delivery.dev, sent: delivery.sent },
    });
  } catch (err) {
    if (err?.code === 11000 || /E11000|dup/.test(err?.message || '')) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    logger.error({ err: err.message }, 'Registration failed');
    return res.status(500).json({ error: err.message });
  }
}

export async function verifyOtpHandler(req, res) {
  const email = req.body?.email?.trim();
  const code = String(req.body?.code ?? '').trim();
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and verification code are required' });
  }
  const user = await getUserVerification(email);
  if (!user) {
    return res.status(404).json({ error: 'No account found for this email' });
  }
  if (user.emailVerified) {
    return res.json({ ok: true, alreadyVerified: true, ...authBodyFromUser(weave(user)) });
  }

  const result = verifyEmailCode(user, code);
  if (!result.ok) {
    // Count every failed attempt toward the limit; invalidate after too many.
    const nextAttempts = (user.otpAttempts || 0) + 1;
    await incrementOtpAttempts(user.id, nextAttempts);
    if (result.reason === 'too_many_attempts' || nextAttempts >= (env.EMAIL_OTP_MAX_ATTEMPTS || 5)) {
      await saveUserVerification(user.id, { otpCodeHash: null });
      return res.status(410).json({ error: 'Too many incorrect attempts. Please resend a new code.', requiresResend: true });
    }
    if (result.reason === 'expired') {
      return res.status(410).json({ error: 'This code has expired. Please request a new one.', requiresResend: true });
    }
    return res.status(400).json({ error: 'Incorrect verification code. Please try again.' });
  }

  await markEmailVerified(user.id);
  logger.info({ userId: user.id }, 'Email verified');
  return res.json({ ok: true, ...authBodyFromUser({ ...user, emailVerified: true }) });
}

export async function resendOtpHandler(req, res) {
  const email = req.body?.email?.trim();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  const user = await getUserVerification(email);
  if (!user) {
    return res.status(404).json({ error: 'No account found for this email' });
  }
  if (user.emailVerified) {
    return res.json({ ok: true, alreadyVerified: true });
  }
  const resendSec = env.EMAIL_OTP_RESEND_SEC || 60;
  const resendAt = user.otpResendAt ? new Date(user.otpResendAt) : null;
  const waitMs = resendAt ? resendAt.getTime() + resendSec * 1000 - Date.now() : 0;
  if (waitMs > 0) {
    return res.status(429).json({ error: `Please wait ${Math.ceil(waitMs / 1000)}s before resending.`, retryAfterSec: Math.ceil(waitMs / 1000) });
  }

  const verification = buildVerification();
  await saveUserVerification(user.id, {
    otpCodeHash: verification.otpCodeHash,
    otpExpiresAt: verification.otpExpiresAt,
    otpAttempts: 0,
    otpResendAt: verification.otpResendAt,
  });
  const delivery = await sendOtpEmail({ to: user.email, otp: verification.code });
  logger.info({ userId: user.id, delivery: delivery.sent ? 'sent' : 'dev' }, 'OTP resent');
  return res.json({ ok: true, delivery: { dev: delivery.dev, sent: delivery.sent } });
}

export async function loginHandler(req, res) {
  const email = req.body?.email?.trim();
  const password = req.body?.password;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = await getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.email_verified) {
    return res.status(403).json({
      error: 'Your email has not been verified yet. Check your inbox for a verification code.',
      requiresVerification: true,
      email: user.email,
    });
  }
  logger.info({ userId: user.id }, 'User logged in');
  return res.json(authBodyFromUser(user));
}

export async function logoutHandler(_req, res) {
  return res.json({ ok: true });
}

export async function meHandler(req, res) {
  const user = await getUserById(req.userId);
  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
  return res.json({
    id: user.id,
    email: user.email,
    groqConfigured: Boolean(user.groq_configured),
    emailVerified: Boolean(user.email_verified),
    created_at: user.created_at || null,
  });
}

function weave(user) {
  return {
    id: user.id,
    email: user.email,
    email_verified: user.emailVerified,
  };
}
