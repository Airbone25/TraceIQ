import pino from 'pino';
import env from '../config/env.js';

const logger = pino({ name: 'email' });

let cachedResend = null;

async function getResend() {
  const key = env.RESEND_API_KEY || process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cachedResend) {
    const { Resend } = await import('resend');
    cachedResend = new Resend(key);
  }
  return cachedResend;
}

function fromAddress() {
  return env.EMAIL_FROM || process.env.EMAIL_FROM || 'Whybase <onboarding@resend.dev>';
}

// Sends the OTP email. Returns { sent: boolean, dev: boolean, code? }.
// When no API key is configured we fall back to logging the code (dev mode) so
// parallel/local testing and the desktop fallback keep working.
export async function sendOtpEmail({ to, otp }) {
  const resend = await getResend();
  const expiryMinutes = env.EMAIL_OTP_TTL_MIN || 15;

  const Html = `
    <h2>Your Whybase verification code</h2>
    <p>Use the code below to finish verifying your email. It expires in ${expiryMinutes} minutes.</p>
    <p style="font-size:28px; letter-spacing:6px; font-weight:700;">${otp}</p>
    <p style="color:#888;">If you didn't request this, you can safely ignore this email.</p>
  `;
  const Text = `Your Whybase verification code is ${otp}. It expires in ${expiryMinutes} minutes. If you didn't request this, you can safely ignore this email.`;

  if (!resend) {
    logger.warn({ to }, `[dev-mode] No RESEND_API_KEY set; OTP emailed would be: ${otp}`);
    return { sent: false, dev: true, code: otp };
  }

  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject: 'Verify your Whybase email',
      html: Html,
      text: Text,
    });
    if (error) {
      logger.error({ err: error.message, to }, 'Resend send failed');
      return { sent: false, dev: false, error: error.message };
    }
    logger.info({ to }, 'OTP email sent');
    return { sent: true, dev: false };
  } catch (err) {
    logger.error({ err: err.message, to }, 'Resend send threw');
    return { sent: false, dev: false, error: err.message };
  }
}
