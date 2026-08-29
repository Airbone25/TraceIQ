const els = {
  groqCurrent: document.getElementById('groq-current'),
  groqKey: document.getElementById('groq-key'),
  groqModel: document.getElementById('groq-model'),
  groqForm: document.getElementById('groq-form'),
  groqVerify: document.getElementById('groq-verify'),
  groqStatus: document.getElementById('groq-status'),
  accountEmail: document.getElementById('account-email'),
  accountCreated: document.getElementById('account-created'),
  emailForm: document.getElementById('account-email-form'),
  newEmail: document.getElementById('new-email'),
  emailCurrentPw: document.getElementById('email-current-pw'),
  emailStatus: document.getElementById('email-status'),
  pwForm: document.getElementById('account-password-form'),
  pwCurrent: document.getElementById('pw-current'),
  pwNew: document.getElementById('pw-new'),
  pwConfirm: document.getElementById('pw-confirm'),
  pwStatus: document.getElementById('pw-status'),
  deleteForm: document.getElementById('delete-account-form'),
  deletePw: document.getElementById('delete-pw'),
  deleteStatus: document.getElementById('delete-status'),
  toast: document.getElementById('settings-toast'),
  connSummary: document.getElementById('conn-summary'),
  aboutMeta: document.getElementById('about-meta'),
  logoutBtn: document.getElementById('logout-btn'),
};

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function showToast(msg, type = 'ok') {
  els.toast.textContent = msg;
  els.toast.className = `settings-toast show ${type}`;
  setTimeout(() => els.toast.classList.remove('show'), 2500);
}

function setStatus(el, msg, ok = true) {
  el.textContent = msg;
  el.className = 'field-status ' + (ok ? 'ok' : 'err');
  if (msg) setTimeout(() => { el.textContent = ''; }, 4000);
}

// ---------- Load ----------
async function loadSettings() {
  try {
    const data = await api('/settings');
    // Groq
    const groq = data.groq;
    els.groqCurrent.textContent = groq.hasKey ? `Active · ${groq.masked} · ${groq.model}` : 'No key set · ' + (groq.model || '');
    els.groqCurrent.className = 'current-key ' + (groq.hasKey ? 'has-key' : 'no-key');
    els.groqModel.value = groq.model || '';
    // Account
    els.accountEmail.textContent = data.account.email;
    els.accountCreated.textContent = data.account.created_at ? `Member since ${new Date(data.account.created_at).toLocaleDateString()}` : '';
    // About
    const app = data.app;
    els.aboutMeta.innerHTML = `
      <div><span>Groq model</span><code>${groq.model}</code></div>
      <div><span>MySQL</span><code>${app.mysql.user}@${app.mysql.host}:${app.mysql.port} / ${app.mysql.database}</code></div>
      <div><span>Max agent steps</span><code>${app.limits.MAX_AGENT_STEPS}</code></div>
      <div><span>Max SQL queries</span><code>${app.limits.MAX_SQL_QUERIES}</code></div>
    `;
  } catch (err) {
    if (err.message.includes('401')) {
      location.href = '/';
      return;
    }
    els.groqCurrent.textContent = err.message;
    els.groqCurrent.className = 'current-key no-key';
  }
}

async function loadConnections() {
  try {
    const [list, health] = await Promise.all([
      api('/connections').catch(() => []),
      api('/connections/health').catch(() => ({ connections: [] })),
    ]);
    const healthMap = new Map((health.connections || []).map(h => [h.id, h.healthy]));
    if (!list.length) {
      els.connSummary.innerHTML = '<p class="field-hint">No connections yet. Add one in the main app.</p>';
      return;
    }
    els.connSummary.innerHTML = list.map(c => {
      const h = healthMap.get(c.id);
      const dot = h === undefined ? 'unknown' : (h ? 'ok' : 'down');
      return `<div class="conn-row-summary"><span class="health-dot ${dot}"></span><strong>${escapeHtml(c.name)}</strong><span class="conn-meta">${escapeHtml(c.user)}@${escapeHtml(c.host)}:${c.port}</span></div>`;
    }).join('');
  } catch (e) {
    els.connSummary.textContent = e.message;
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------- Groq ----------
els.groqForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = els.groqKey.value.trim();
  const model = els.groqModel.value.trim();
  if (!key && !model) {
    setStatus(els.groqStatus, 'Nothing to save', false);
    return;
  }
  const btn = document.getElementById('groq-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const res = await api('/settings/groq', { method: 'PUT', body: JSON.stringify({ apiKey: key, model }) });
    setStatus(els.groqStatus, 'Saved ✔', true);
    showToast('Groq settings updated');
    els.groqKey.value = '';
    els.groqCurrent.textContent = `Active · ${res.groq.masked} · ${res.groq.model}`;
    els.groqCurrent.className = 'current-key has-key';
    els.groqModel.value = res.groq.model;
  } catch (err) {
    setStatus(els.groqStatus, err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Groq settings';
  }
});

els.groqVerify.addEventListener('click', async () => {
  const key = els.groqKey.value.trim();
  els.groqVerify.disabled = true;
  els.groqVerify.textContent = 'Verifying…';
  try {
    const body = await api('/settings/groq/verify', { method: 'POST', body: JSON.stringify({ apiKey: key || undefined }) });
    setStatus(els.groqStatus, body.ok ? 'Key is valid ✔' : body.error, body.ok);
    showToast(body.ok ? 'Key verified' : body.error, body.ok ? 'ok' : 'err');
  } catch (err) {
    setStatus(els.groqStatus, err.message, false);
  } finally {
    els.groqVerify.disabled = false;
    els.groqVerify.textContent = 'Verify key';
  }
});

// ---------- Account email ----------
els.emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const newEmail = els.newEmail.value.trim();
  const currentPassword = els.emailCurrentPw.value;
  if (!newEmail) return setStatus(els.emailStatus, 'New email required', false);
  if (!currentPassword) return setStatus(els.emailStatus, 'Current password required', false);
  try {
    const res = await api('/settings/account', { method: 'PUT', body: JSON.stringify({ email: newEmail, currentPassword }) });
    setStatus(els.emailStatus, 'Email updated ✔', true);
    showToast('Email updated');
    els.accountEmail.textContent = res.account.email;
    els.newEmail.value = '';
    els.emailCurrentPw.value = '';
  } catch (err) {
    setStatus(els.emailStatus, err.message, false);
  }
});

// ---------- Password ----------
els.pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = els.pwCurrent.value;
  const newPassword = els.pwNew.value;
  const confirm = els.pwConfirm.value;
  if (!currentPassword) return setStatus(els.pwStatus, 'Current password required', false);
  if (newPassword.length < 8) return setStatus(els.pwStatus, 'New password must be at least 8 chars', false);
  if (newPassword !== confirm) return setStatus(els.pwStatus, 'Passwords do not match', false);
  try {
    await api('/settings/account', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
    setStatus(els.pwStatus, 'Password updated ✔', true);
    showToast('Password updated');
    els.pwCurrent.value = ''; els.pwNew.value = ''; els.pwConfirm.value = '';
  } catch (err) {
    setStatus(els.pwStatus, err.message, false);
  }
});

// ---------- Delete ----------
els.deleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = els.deletePw.value;
  if (!pw) return setStatus(els.deleteStatus, 'Password required', false);
  if (!confirm('Permanently delete your account and all data? This cannot be undone.')) return;
  if (!confirm('Are you absolutely sure? Type OK to proceed: ' + 'Delete')) {
    // second guard
  }
  try {
    await api('/settings/account', { method: 'DELETE', body: JSON.stringify({ password: pw }) });
    showToast('Account deleted — redirecting…');
    setTimeout(() => location.href = '/', 1200);
  } catch (err) {
    setStatus(els.deleteStatus, err.message, false);
  }
});

// ---------- Appearance ----------
const THEME_KEY = 'traceiq-theme';
function applyTheme(theme) {
  if (theme === 'auto') {
    localStorage.removeItem(THEME_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
  document.querySelectorAll('.theme-option').forEach(b => {
    b.classList.toggle('active', (localStorage.getItem(THEME_KEY) || 'auto') === b.dataset.theme || (!localStorage.getItem(THEME_KEY) && b.dataset.theme === 'auto'));
  });
}
document.querySelectorAll('.theme-option').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) applyTheme(saved);
  else applyTheme('auto');
})();

// ---------- Nav tabs ----------
function activateTab(tab) {
  document.querySelectorAll('.settings-nav-link').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  document.querySelectorAll('.settings-section').forEach(s => s.classList.toggle('hidden', s.id !== `tab-${tab}`));
  if (tab === 'connections') loadConnections();
}
document.querySelectorAll('.settings-nav-link').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = a.dataset.tab;
    history.replaceState(null, '', `#${tab}`);
    activateTab(tab);
  });
});
const initial = location.hash.replace('#','') || 'groq';
activateTab(initial);

// ---------- Logout ----------
els.logoutBtn.addEventListener('click', async () => {
  if (!confirm('Sign out? You will need to sign in again.')) return;
  const btn = els.logoutBtn;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute('data-loading', 'true');
  btn.innerHTML = '<span class="signout-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span> Signing out…';
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  showToast('Signed out', 'ok');
  setTimeout(() => { location.href = '/'; }, 400);
});

loadSettings();
loadConnections();
