import pino from 'pino';
import env from '../config/env.js';

const logger = pino({ name: 'email' });

let cachedTransporter = null;

// SMTP delivery via node mailer (defaults to Gmail's app-password SMTP). When
// SMTP_USER/SMTP_PASS are missing we fall back to logging the code (dev mode).
async function getTransporter() {
  const user = env.SMTP_USER || process.env.SMTP_USER;
  const pass = env.SMTP_PASS || process.env.SMTP_PASS;
  if (!user || !pass) return null;
  if (!cachedTransporter) {
    const { createTransport } = await import('nodemailer');
    const port = Number(env.SMTP_PORT || process.env.SMTP_PORT || 465);
    cachedTransporter = createTransport({
      host: env.SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return cachedTransporter;
}

function fromAddress() {
  const explicit = env.EMAIL_FROM || process.env.EMAIL_FROM;
  if (explicit) return explicit;
  const user = env.SMTP_USER || process.env.SMTP_USER;
  return user ? `Whybase <${user}>` : 'Whybase <no-reply@local>';
}

// Sends the OTP email. Returns { sent: boolean, dev: boolean, code? }.
// When no SMTP credentials are configured we fall back to logging the code (dev
// mode) so parallel/local testing and the desktop fallback keep working.
export async function sendOtpEmail({ to, otp }) {
  const transporter = await getTransporter();
  const expiryMinutes = env.EMAIL_OTP_TTL_MIN || 15;

  const Html = `
    <h2>Your Whybase verification code</h2>
    <p>Use the code below to finish verifying your email. It expires in ${expiryMinutes} minutes.</p>
    <p style="font-size:28px; letter-spacing:6px; font-weight:700;">${otp}</p>
    <p style="color:#888;">If you didn't request this, you can safely ignore this email.</p>
  `;
  const Text = `Your Whybase verification code is ${otp}. It expires in ${expiryMinutes} minutes. If you didn't request this, you can safely ignore this email.`;

  if (!transporter) {
    logger.warn({ to }, `[dev-mode] No SMTP credentials set; OTP emailed would be: ${otp}`);
    return { sent: false, dev: true, code: otp };
  }

  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject: 'Verify your Whybase email',
      html: Html,
      text: Text,
    });
    logger.info({ to }, 'OTP email sent');
    return { sent: true, dev: false };
  } catch (err) {
    logger.error({ err: err.message, to }, 'SMTP send failed');
    return { sent: false, dev: false, error: err.message };
  }
}