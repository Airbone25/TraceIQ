import pino from 'pino';
import { getGroqStatus, getAppConfig, updateGroqConfig, updateAccountGroqConfig, verifyGroqKey } from '../services/settings.service.js';
import { getUserById, getUserByEmail, verifyPassword, updateUserEmail, updateUserPassword, deleteUser } from '../database/user-store.js';
import { clearSessionCookie } from '../middleware/auth.js';

const logger = pino({ name: 'settings-controller' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getSettingsHandler(req, res) {
  try {
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const groq = await getGroqStatus(req.userId);
    const app = getAppConfig();
    res.json({
      groq,
      account: { id: user.id, email: user.email, created_at: user.created_at },
      app,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get settings');
    res.status(500).json({ error: 'Failed to load settings', detail: err.message });
  }
}

export async function getGroqHandler(req, res) {
  try {
    res.json(await getGroqStatus(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateGroqHandler(req, res) {
  const { apiKey, model, groqApiKey, groqModel } = req.body || {};
  // support both naming conventions from electron settings (groqApiKey) and web (apiKey)
  const key = apiKey ?? groqApiKey;
  const mdl = model ?? groqModel;
  if ((key == null || String(key).trim() === '') && (mdl == null || String(mdl).trim() === '')) {
    return res.status(400).json({ error: 'Provide apiKey and/or model to update' });
  }
  try {
    const result = await updateAccountGroqConfig(req.userId, { apiKey: key, model: mdl });
    logger.info({ userId: req.userId, model: mdl ? String(mdl).slice(0, 40) : undefined, keyUpdated: Boolean(key && String(key).trim()) }, 'Groq config updated');
    res.json({ ok: true, groq: result });
  } catch (err) {
    logger.warn({ err: err.message }, 'Groq update failed');
    res.status(400).json({ error: err.message });
  }
}

export async function verifyGroqHandler(req, res) {
  const { apiKey } = req.body || {};
  try {
    const result = await verifyGroqKey(apiKey);
    if (result.ok) return res.json({ ok: true, model: result.model });
    return res.status(400).json({ ok: false, error: result.error, status: result.status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function updateAccountHandler(req, res) {
  const { email, currentPassword, newPassword, password, newEmail } = req.body || {};
  // Allow flexible payload: { email } or { newEmail } and { newPassword } or { password }
  const targetEmail = email ?? newEmail;
  const targetNewPassword = newPassword ?? password;

  if (!targetEmail && !targetNewPassword) {
    return res.status(400).json({ error: 'Provide email and/or newPassword to update' });
  }

  try {
    const currentUser = await getUserById(req.userId);
    if (!currentUser) return res.status(404).json({ error: 'User not found' });
    // For verification, need password_hash — fetch via email (getUserById omits hash)
    const withHash = await getUserByEmail(currentUser.email);
    if (!withHash) return res.status(404).json({ error: 'User not found' });

    if (!currentPassword) {
      return res.status(400).json({ error: 'currentPassword is required to make changes' });
    }
    const ok = await verifyPassword(currentPassword, withHash.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const result = { email: currentUser.email };

    if (targetEmail) {
      const trimmed = String(targetEmail).trim().toLowerCase();
      if (!EMAIL_RE.test(trimmed)) return res.status(400).json({ error: 'A valid email address is required' });
      const existing = await getUserByEmail(trimmed);
      if (existing && existing.id !== req.userId) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      await updateUserEmail(req.userId, trimmed);
      result.email = trimmed;
    }

    if (targetNewPassword) {
      if (String(targetNewPassword).length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      await updateUserPassword(req.userId, String(targetNewPassword));
    }

    const updated = await getUserById(req.userId);
    res.json({ ok: true, account: updated });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to update account');
    res.status(500).json({ error: 'Failed to update account', detail: err.message });
  }
}

export async function updatePasswordOnlyHandler(req, res) {
  // Dedicated handler for PUT /api/settings/password if needed
  req.body = { newPassword: req.body?.newPassword || req.body?.password, currentPassword: req.body?.currentPassword, email: undefined };
  return updateAccountHandler(req, res);
}

export async function deleteAccountHandler(req, res) {
  const { password, currentPassword } = req.body || {};
  const pw = password || currentPassword;
  if (!pw) return res.status(400).json({ error: 'Password is required to delete account' });
  try {
    const currentUser = await getUserById(req.userId);
    if (!currentUser) return res.status(404).json({ error: 'User not found' });
    const withHash = await getUserByEmail(currentUser.email);
    if (!withHash) return res.status(404).json({ error: 'User not found' });
    const ok = await verifyPassword(pw, withHash.password_hash);
    if (!ok) return res.status(401).json({ error: 'Password is incorrect' });

    await deleteUser(req.userId);
    clearSessionCookie(res);
    logger.info({ userId: req.userId }, 'Account deleted');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to delete account');
    res.status(500).json({ error: 'Failed to delete account', detail: err.message });
  }
}
