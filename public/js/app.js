const POLL_INTERVAL_MS = 2000;
const NEAR_BOTTOM_THRESHOLD_PX = 80;
const AUTH_TOKEN_KEY = 'tq_cloud_token';

function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch { return null; }
}
function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

const els = {
  appLayout: document.getElementById('app-layout'),
  authView: document.getElementById('auth-view'),
  authForm: document.getElementById('auth-form'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  authSubmit: document.getElementById('auth-submit'),
  authError: document.getElementById('auth-error'),
  authSwitch: document.getElementById('auth-switch'),
  authToggleText: document.getElementById('auth-toggle-text'),
  groqSetupView: document.getElementById('groq-setup-view'),
  groqSetupForm: document.getElementById('groq-setup-form'),
  groqSetupKey: document.getElementById('groq-setup-key'),
  groqSetupSubmit: document.getElementById('groq-setup-submit'),
  groqSetupVerify: document.getElementById('groq-setup-verify'),
  groqSetupError: document.getElementById('groq-setup-error'),
  groqSetupLink: document.getElementById('groq-setup-link'),
  otpView: document.getElementById('otp-view'),
  otpForm: document.getElementById('otp-form'),
  otpCode: document.getElementById('otp-code'),
  otpSubmit: document.getElementById('otp-submit'),
  otpResend: document.getElementById('otp-resend'),
  otpBack: document.getElementById('otp-back'),
  otpError: document.getElementById('otp-error'),
  otpEmail: document.getElementById('otp-email'),
  logoutBtn: document.getElementById('logout-btn'),
  logoutModal: document.getElementById('logout-modal'),
  logoutConfirm: document.getElementById('logout-confirm'),
  logoutCancel: document.getElementById('logout-cancel'),
  sidebarUser: document.getElementById('sidebar-user'),
  sidebarUserEmail: document.getElementById('sidebar-user-email'),
  sidebarUserAvatar: document.getElementById('sidebar-user-avatar'),
  appToast: document.getElementById('app-toast'),
  threadList: document.getElementById('thread-list'),
  newThreadBtn: document.getElementById('new-thread-btn'),
  messages: document.getElementById('messages'),
  form: document.getElementById('ask-form'),
  input: document.getElementById('question-input'),
  sendBtn: document.getElementById('send-btn'),
  composerWrap: document.getElementById('composer-wrap'),
  healthDot: document.getElementById('health-dot'),
  targetBadge: document.getElementById('target-badge'),
  newChatModal: document.getElementById('new-chat-modal'),
  wizardTitle: document.getElementById('wizard-title'),
  closeNewChatModal: document.getElementById('close-new-chat-modal'),
  wizardStepConnection: document.getElementById('wizard-step-connection'),
  wizardStepDatabase: document.getElementById('wizard-step-database'),
  connectionsList: document.getElementById('connections-list'),
  toggleAddConnection: document.getElementById('toggle-add-connection'),
  addConnectionForm: document.getElementById('add-connection-form'),
  wizardBack: document.getElementById('wizard-back'),
  databaseList: document.getElementById('database-list'),
  firstRunBanner: document.getElementById('first-run-banner'),
  exploreSchemaToggle: document.getElementById('explore-schema-toggle'),
  exploreSchemaCaret: document.getElementById('explore-schema-caret'),
  exploreSchema: document.getElementById('explore-schema'),
  themeToggle: document.getElementById('theme-toggle'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  sidebar: document.getElementById('sidebar'),
};

let state = {
  threads: [],
  activeThreadId: null,
  detail: null,
  pollTimer: null,
  viewGen: 0,
  renderedThreadId: null,
  renderedMessageCount: 0,
  renderedStepCount: 0,
  lastRunStatus: null,
  pendingTarget: null,
  draftQuestion: null,
  wizardConnectionId: null,
  connectionsCache: [],
  threadsLoading: false,
  threadsLoaded: false,
  pendingOtpEmail: null,
  eventController: null,
  eventStreamOpen: false,
};

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) {
    if (res.status === 401 && !path.startsWith('/auth/') && els.authView.classList.contains('hidden')) {
      sessionExpired();
    }
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { ok: res.ok, status: res.status, body };
}

/* ---------- Authentication ---------- */

let authMode = 'login';

function showToast(msg, type = 'ok') {
  if (!els.appToast) return;
  els.appToast.textContent = msg;
  els.appToast.className = `settings-toast show ${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.appToast.classList.remove('show'), 2500);
}

function updateSidebarUser(user) {
  if (!els.sidebarUser || !els.sidebarUserEmail) return;
  if (user && user.email) {
    els.sidebarUserEmail.textContent = user.email;
    els.sidebarUserEmail.title = user.email;
    if (els.sidebarUserAvatar) {
      const initial = user.email.trim()[0]?.toUpperCase() || '?';
      els.sidebarUserAvatar.textContent = initial;
    }
    els.sidebarUser.classList.remove('hidden');
  } else {
    els.sidebarUser.classList.add('hidden');
  }
}

function openLogoutModal() {
  if (!els.logoutModal) return;
  els.logoutModal.classList.remove('hidden');
  els.logoutConfirm?.focus();
}

function closeLogoutModal() {
  if (!els.logoutModal) return;
  els.logoutModal.classList.add('hidden');
}

async function performLogout() {
  const btn = els.logoutConfirm || els.logoutBtn;
  const origText = btn ? btn.textContent : '';
  if (els.logoutBtn) {
    els.logoutBtn.disabled = true;
    els.logoutBtn.setAttribute('data-loading', 'true');
    els.logoutBtn.querySelector('.signout-label').textContent = 'Signing out…';
  }
  if (els.logoutConfirm) {
    els.logoutConfirm.disabled = true;
    els.logoutConfirm.textContent = 'Signing out…';
  }
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch { /* clear locally regardless */ }
  closeLogoutModal();
  if (els.logoutBtn) {
    els.logoutBtn.disabled = false;
    els.logoutBtn.removeAttribute('data-loading');
    els.logoutBtn.querySelector('.signout-label').textContent = 'Sign out';
  }
  if (els.logoutConfirm) {
    els.logoutConfirm.disabled = false;
    els.logoutConfirm.textContent = origText || 'Sign out';
  }
  showToast('Signed out', 'ok');
  setAuthToken(null);
  sessionExpired();
}

function sessionExpired() {
  stopPolling();
  updateSidebarUser(null);
  showAuthView();
}

function showAuthView() {
  els.appLayout.classList.add('hidden');
  els.groqSetupView.classList.add('hidden');
  els.otpView.classList.add('hidden');
  clearOtpCountdown();
  els.authView.classList.remove('hidden');
  els.authPassword.value = '';
  els.authError.textContent = '';
}

function showGroqSetupView() {
  els.authView.classList.add('hidden');
  els.appLayout.classList.add('hidden');
  els.otpView.classList.add('hidden');
  clearOtpCountdown();
  els.groqSetupKey.value = '';
  els.groqSetupError.textContent = '';
  els.groqSetupError.classList.remove('shake');
  els.groqSetupView.classList.remove('hidden');
}

function enterApp() {
  els.authView.classList.add('hidden');
  els.groqSetupView.classList.add('hidden');
  els.otpView.classList.add('hidden');
  clearOtpCountdown();
  els.appLayout.classList.remove('hidden');
  refreshThreads();
  cacheConnections();
  newThread();
}

function showOtpView(email) {
  els.authView.classList.add('hidden');
  els.groqSetupView.classList.add('hidden');
  els.appLayout.classList.add('hidden');
  state.pendingOtpEmail = email || null;
  els.otpEmail.textContent = state.pendingOtpEmail || '';
  els.otpCode.value = '';
  els.otpError.textContent = '';
  els.otpCode.disabled = false;
  els.otpSubmit.disabled = false;
  els.otpView.classList.remove('hidden');
  setTimeout(() => els.otpCode?.focus(), 0);
  startOtpCountdown();
}

function setOtpError(msg) {
  els.otpError.textContent = msg;
  els.otpError.classList.remove('shake');
  // force reflow to restart the shake animation
  void els.otpError.offsetWidth;
  els.otpError.classList.add('shake');
}

let otpCountdownTimer = null;
function startOtpCountdown(seconds = 10) {
  const btn = els.otpResend;
  clearOtpCountdown();
  btn.disabled = true;
  let remaining = Math.max(1, Math.floor(seconds));
  const tick = () => {
    btn.textContent = `Resend code (${remaining}s)`;
    if (remaining <= 0) {
      clearInterval(otpCountdownTimer);
      otpCountdownTimer = null;
      btn.textContent = 'Resend code';
      btn.disabled = false;
    } else {
      remaining--;
    }
  };
  tick();
  otpCountdownTimer = setInterval(tick, 1000);
}
function clearOtpCountdown() {
  if (otpCountdownTimer) {
    clearInterval(otpCountdownTimer);
    otpCountdownTimer = null;
  }
}

async function initSession() {
  if (!getAuthToken()) {
    updateSidebarUser(null);
    showAuthView();
    return;
  }
  try {
    const { body } = await api('/auth/me');
    updateSidebarUser(body);
    if (body.groqConfigured === false) {
      showGroqSetupView();
      return;
    }
    enterApp();
  } catch {
    setAuthToken(null);
    updateSidebarUser(null);
    showAuthView();
  }
}

function setAuthMode(mode) {
  authMode = mode;
  els.authSubmit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
  els.authToggleText.textContent = mode === 'login' ? 'No account?' : 'Already have an account?';
  els.authSwitch.textContent = mode === 'login' ? 'Create one' : 'Sign in';
  els.authError.textContent = '';
}

async function submitAuth(event) {
  event.preventDefault();
  const path = authMode === 'login' ? '/auth/login' : '/auth/register';
  if (authMode === 'register') {
    els.authPassword.setAttribute('autocomplete', 'new-password');
  }
  els.authSubmit.disabled = true;
  try {
    const { status, body: authBody } = await api(path, {
      method: 'POST',
      body: JSON.stringify({
        email: els.authEmail.value.trim(),
        password: els.authPassword.value,
      }),
    });
    if (status === 409) {
      els.authError.textContent = authBody?.error || 'An account with this email already exists';
      return;
    }
    if (authBody && authBody.requiresVerification) {
      // Registration: OTP must be verified before a token is issued.
      showOtpView(authBody.email || els.authEmail.value.trim());
      return;
    }
    if (authBody && authBody.token) setAuthToken(authBody.token);
    const { body } = await api('/auth/me');
    updateSidebarUser(body);
    if (body.groqConfigured === false) {
      showGroqSetupView();
    } else {
      enterApp();
    }
  } catch (err) {
    if (err.status === 403 && err.body?.requiresVerification) {
      showOtpView(err.body.email || els.authEmail.value.trim());
    } else {
      els.authError.textContent = err.message;
    }
  } finally {
    els.authSubmit.disabled = false;
  }
}

async function submitOtp(event) {
  event.preventDefault();
  const email = state.pendingOtpEmail;
  const code = els.otpCode.value.trim();
  if (!email || !code) {
    setOtpError('Enter the 6-digit code from your email.');
    return;
  }
  els.otpSubmit.disabled = true;
  els.otpCode.disabled = true;
  els.otpError.textContent = '';
  try {
    const { body } = await api('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    if (body.token) setAuthToken(body.token);
    const me = await api('/auth/me');
    updateSidebarUser(me.body);
    if (me.body.groqConfigured === false) {
      showGroqSetupView();
    } else {
      enterApp();
    }
  } catch (err) {
    els.otpCode.disabled = false;
    setOtpError(err.message);
    if (err.status === 410) {
      startOtpCountdown();
    }
  } finally {
    els.otpSubmit.disabled = false;
  }
}

async function resendOtp() {
  const email = state.pendingOtpEmail;
  if (!email) return;
  els.otpResend.disabled = true;
  els.otpError.textContent = '';
  try {
    await api('/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    els.otpCode.value = '';
    setOtpError('A new code was sent.');
    startOtpCountdown();
  } catch (err) {
    setOtpError(err.message);
    if (err.status !== 429) {
      els.otpResend.disabled = false;
    } else {
      // Server-enforced cooldown; reflect it in the button.
      startOtpCountdown(err.body?.retryAfterSec || 10);
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const SQL_KEYWORDS = new Set(('SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER FULL CROSS ON AS AND OR NOT NULL IS IN LIKE BETWEEN EXISTS GROUP BY ORDER ASC DESC HAVING LIMIT OFFSET UNION ALL DISTINCT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP ALTER ADD INDEX KEY PRIMARY FOREIGN REFERENCES UNIQUE CONSTRAINT DEFAULT CASE WHEN THEN ELSE END WITH RECURSIVE OVER PARTITION AS')
  .split(/\s+/).filter(Boolean));

function highlightSql(escapedSql) {
  const tokenRe = /([A-Za-z_][A-Za-z0-9_]*)|('(?:[^'\\]|\\.)*'?)|("(?:[^"\\]|\\.)*"?)|(\b\d+(?:\.\d+)?\b)|(--[^\n]*|\/\*[\s\S]*?\*\/)/g;
  return escapedSql.replace(tokenRe, (m, word, sq, dq, num, comment) => {
    if (comment !== undefined && comment !== '') return `<span class="tok-com">${comment}</span>`;
    if (sq !== undefined && sq !== '' || dq !== undefined && dq !== '') return `<span class="tok-str">${m}</span>`;
    if (num !== undefined) return `<span class="tok-num">${num}</span>`;
    if (word !== undefined && word !== '') {
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) return `<span class="tok-kw">${word}</span>`;
      return word;
    }
    return m;
  });
}

function inlineFormat(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

const NUMERIC_CELL = /^-?[\d,.]+%?$/;

function isSeparatorLine(line) {
  return /^[\s|:-]+$/.test(line);
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function buildTable(blockLines) {
  const parsed = blockLines.map(parseTableRow);
  const header = parsed[0];
  const bodyRows = parsed.slice(1).filter((_, idx) => !(idx === 0 && isSeparatorLine(blockLines[1])));
  const th = header.map(c => `<th>${inlineFormat(c)}</th>`).join('');
  const tr = bodyRows
    .map(cells => `<tr>${cells.map(c => `<td${NUMERIC_CELL.test(c) ? ' class="num"' : ''}>${inlineFormat(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table class="answer-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function renderCodeBlock(fence, code) {
  const lang = (fence || '').trim().toLowerCase();
  const inner = lang === 'sql' ? highlightSql(code) : code;
  const id = 'cb' + Math.random().toString(36).slice(2, 8);
  const head = `<div class="code-block-head"><span>${escapeHtml(lang || 'code')}</span><button class="copy-btn" data-copy="${id}">Copy</button></div>`;
  return `<div class="code-block" id="${id}">${head}<pre><code>${inner}</code></pre></div>`;
}

function renderRichText(markdown) {
  const escaped = escapeHtml(markdown);
  const rawLines = escaped.split('\n');
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].trim().startsWith('```')) {
      const fence = rawLines[i].trim().slice(3);
      const buf = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trim().startsWith('```')) {
        buf.push(rawLines[i]);
        i++;
      }
      lines.push({ type: 'code', fence, body: buf.join('\n') });
    } else {
      lines.push({ type: 'text', body: rawLines[i] });
    }
  }

  let html = '';
  let listStack = [];
  let i = 0;

  const closeListsUpTo = (depth) => {
    while (listStack.length > depth) {
      const t = listStack.pop();
      html += t === 'ul' ? '</ul>' : '</ol>';
    }
  };

  while (i < lines.length) {
    const item = lines[i];
    const line = item.body;

    if (item.type === 'code') {
      closeListsUpTo(0);
      html += renderCodeBlock(item.fence, item.body);
      i++;
      continue;
    }

    const t = line.trim();
    if (t.startsWith('|')) {
      closeListsUpTo(0);
      let j = i;
      const block = [];
      while (j < lines.length && lines[j].type === 'text' && lines[j].body.trim().startsWith('|')) {
        block.push(lines[j].body);
        j++;
      }
      html += buildTable(block);
      i = j;
      continue;
    }

    const hr = t.match(/^(---|\*\*\*|___)$/);
    if (hr && /^[-*_]{3,}$/.test(t)) {
      closeListsUpTo(0);
      html += '<hr>';
      i++;
      continue;
    }

    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeListsUpTo(0);
      const n = h[1].length;
      html += `<div class="md-h${n}">${inlineFormat(h[2])}</div>`;
      i++;
      continue;
    }

    const quote = t.match(/^(\&gt;|>)\s?(.*)$/);
    if (quote) {
      closeListsUpTo(0);
      html += `<blockquote class="md-quote"><p class="md-quote-p">${inlineFormat(quote[2] || '')}</p></blockquote>`;
      i++;
      continue;
    }

    const ol = line.match(/^\s*(\d+)\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ol) {
      if (listStack[listStack.length - 1] !== 'ol') {
        closeListsUpTo(0);
        html += '<ol class="md-ol">';
        listStack.push('ol');
      }
      html += `<li>${inlineFormat(ol[2])}</li>`;
      i++;
      continue;
    }
    if (ul) {
      if (listStack[listStack.length - 1] !== 'ul') {
        closeListsUpTo(0);
        html += '<ul class="md-list">';
        listStack.push('ul');
      }
      html += `<li>${inlineFormat(ul[1])}</li>`;
      i++;
      continue;
    }

    closeListsUpTo(0);
    if (t) html += `<p>${inlineFormat(line)}</p>`;
    i++;
  }
  closeListsUpTo(0);
  return html;
}

function formatDuration(ms) {
  if (ms == null) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/* ---------- Scrolling ---------- */

function isNearBottom() {
  return els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
}

function scrollToBottomNow() {
  els.messages.style.scrollBehavior = 'auto';
  els.messages.scrollTop = els.messages.scrollHeight;
  els.messages.style.scrollBehavior = '';
}

/* ---------- Sidebar ---------- */

function renderSidebar() {
  if (state.threadsLoading) {
    els.threadList.innerHTML = [
      '<li class="skeleton skeleton-thread"><span class="skeleton skeleton-thread-title"></span><span class="skeleton skeleton-thread-db"></span></li>',
      '<li class="skeleton skeleton-thread"><span class="skeleton skeleton-thread-title"></span></li>',
      '<li class="skeleton skeleton-thread"><span class="skeleton skeleton-thread-title"></span></li>',
      '<li class="skeleton skeleton-thread"><span class="skeleton skeleton-thread-title"></span></li>',
    ].join('');
    return;
  }
  els.threadList.innerHTML = '';
  if (state.threads.length === 0) {
    els.threadList.innerHTML = '<li class="sidebar-empty">No investigations yet</li>';
    return;
  }
  for (const t of state.threads) {
    const li = document.createElement('li');
    li.className = 'thread-item' + (t.id === state.activeThreadId ? ' active' : '');
    li.innerHTML = `
      <span class="status-dot ${t.latest_status || 'queued'}"></span>
      <span class="thread-title">${escapeHtml(t.title)}${t.target_database ? ` <span class="thread-db">${escapeHtml(t.target_database)}</span>` : ''}</span>
      <button class="thread-delete-btn" title="Delete investigation">&#128465;</button>`;
    li.addEventListener('click', () => openThread(t.id));
    li.querySelector('.thread-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteThreadFlow(t.id, t.title);
    });
    els.threadList.appendChild(li);
  }
}

async function deleteThreadFlow(threadId, title) {
  if (!confirm(`Delete this investigation?\n\n"${title}"\n\nThis permanently removes its messages and audit history.`)) return;
  try {
    await api(`/threads/${threadId}`, { method: 'DELETE' });
    if (state.activeThreadId === threadId) newThread();
    await refreshThreads();
  } catch (err) {
    alert(`Failed to delete: ${err.message}`);
  }
}

async function refreshThreads() {
  try {
    if (!state.threadsLoaded) { state.threadsLoading = true; renderSidebar(); }
    const { body } = await api('/threads');
    state.threads = body;
    state.threadsLoading = false;
    state.threadsLoaded = true;
    renderSidebar();
    // keep empty/select state in sync after loading threads
    if (!state.activeThreadId) {
      renderEmptyState();
      updateTargetBadge();
      if (state.pendingTarget) {
        setComposerVisible(true);
        setComposerEnabled(true);
      } else {
        setComposerVisible(false);
        setComposerEnabled(false);
      }
    }
  } catch { state.threadsLoading = false; renderSidebar(); /* sidebar refresh is best-effort */ }
}

/* ---------- Messages ---------- */

function messagesInner() {
  let inner = document.getElementById('messages-inner');
  if (!inner) {
    els.messages.innerHTML = '<div class="messages-inner" id="messages-inner"></div>';
    inner = document.getElementById('messages-inner');
  }
  return inner;
}

function clearMessages() {
  els.messages.innerHTML = '<div class="messages-inner" id="messages-inner"></div>';
  state.renderedMessageCount = 0;
  state.renderedStepCount = 0;
}

function buildMessageBubble(role, content, meta) {
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (role === 'assistant' && meta?.failed ? ' error-bubble' : '');
  bubble.innerHTML = role === 'user'
    ? `<p>${escapeHtml(content)}</p>`
    : renderRichText(content);
  if (meta && !meta.failed) {
    const parts = [];
    if (meta.duration != null) parts.push(`${formatDuration(meta.duration)}`);
    if (meta.steps != null) parts.push(`${meta.steps} steps`);
    if (meta.sqlQueries != null) parts.push(`${meta.sqlQueries} SQL queries`);
    if (parts.length) {
      bubble.innerHTML += `<div class="answer-meta"><span>${parts.join('</span><span>')}</span></div>`;
    }
  }
  msg.appendChild(bubble);
  return msg;
}

function appendMessage(role, content, meta) {
  messagesInner().appendChild(buildMessageBubble(role, content, meta));
  state.renderedMessageCount++;
}

/* ---------- Progress card (live, non-persistent) ---------- */

function ensureProgressCard() {
  let card = document.getElementById('progress-card');
  if (!card) {
    card = document.createElement('div');
    card.className = 'msg assistant';
    card.id = 'progress-card';
    card.innerHTML = `
      <div class="progress-card">
        <div class="progress-header"><span class="spinner"></span> <span class="progress-label">Investigating...</span>
          <button type="button" id="stop-run-btn" class="stop-btn" title="Stop this investigation">Stop</button>
        </div>
        <div class="progress-steps"></div>
      </div>`;
    messagesInner().appendChild(card);
    state.renderedStepCount = 0;
    card.querySelector('#stop-run-btn').addEventListener('click', cancelActiveRun);
  }
  return card;
}

async function cancelActiveRun() {
  const run = state.detail?.runs?.length ? state.detail.runs[state.detail.runs.length - 1] : null;
  if (!run || run.status !== 'running' || !run.id) return;
  const btn = document.getElementById('stop-run-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Stopping…';
  }
  try {
    await api(`/investigations/${run.id}/cancel`, { method: 'POST' });
  } catch (err) {
    // Best-effort: the run may finish on its own; polling will catch up.
    appendMessage('assistant', `Could not stop investigation: ${err.message}`, { failed: true });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Stop';
    }
  }
}

const STEP_META = {
  get_schema: { label: 'Inspect schema', icon: '▤' },
  get_overview: { label: 'Database overview', icon: '☰' },
  execute_sql: { label: 'SQL query', icon: '⛃' },
};

function renderSampleRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<p class="step-empty">No rows returned.</p>';
  }
  const sampled = rows.slice(0, 20);
  const columns = Object.keys(sampled[0]);
  const th = columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const tr = sampled
    .map(r => `<tr>${columns.map(c => `<td>${escapeHtml(formatCell(r[c]))}</td>`).join('')}</tr>`)
    .join('');
  const more = rows.length > sampled.length ? `<p class="step-more">… showing ${sampled.length} of ${rows.length} rows</p>` : '';
  return `<div class="table-wrap"><table class="answer-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>${more}`;
}

function formatCell(value) {
  if (value == null) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildStepCard(step) {
  const card = document.createElement('div');
  card.className = 'step-card';
  const toolName = step.tool_name;
  const meta = STEP_META[toolName] || { label: toolName, icon: '•' };
  const sql = step.tool_input?.sql;

  let summary = '';
  let details = '';

  if (toolName === 'execute_sql') {
    const out = step.tool_output || {};
    const rowCount = out.rowCount ?? (Array.isArray(out.rows) ? out.rows.length : null);
    const ok = out.success !== false;
    summary = ok
      ? `${rowCount == null ? 'query' : rowCount + ' row' + (rowCount === 1 ? '' : 's')}${out.truncated ? ' (truncated)' : ''}${out.duration ? ' · ' + formatDuration(out.duration) : ''}`
      : 'failed';
    details = `<div class="step-sql">${highlightSql(escapeHtml(sql || ''))}</div>`;
    if (Array.isArray(out.rows)) {
      details += renderSampleRows(out.rows);
    } else if (out.error) {
      details += `<p class="step-empty">Error: ${escapeHtml(out.error)}</p>`;
    }
    card.classList.add(ok ? 'step-ok' : 'step-err');
  } else if (toolName === 'get_schema') {
    const out = step.tool_output || {};
    const tables = Array.isArray(out.tables) ? out.tables : [];
    summary = `${tables.length} table${tables.length === 1 ? '' : 's'}`;
    details = Array.isArray(out.summary)
      ? `<ul class="step-tables">${out.summary.slice(0, 30).map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
      : '';
  } else if (toolName === 'get_overview') {
    const out = step.tool_output || {};
    const tables = Array.isArray(out.tables) ? out.tables : [];
    const ranges = Array.isArray(out.dateRanges) ? out.dateRanges : [];
    summary = `${tables.length} table${tables.length === 1 ? '' : 's'}, ${ranges.length} date range${ranges.length === 1 ? '' : 's'}`;
    const tableLines = tables.map(t => `${escapeHtml(t.name)} (${t.rowCount} rows)`).join('<br>');
    const rangeLines = ranges.slice(0, 20).map(r => `${escapeHtml(r.table)}.${escapeHtml(r.column)}: ${escapeHtml(String(r.min))} → ${escapeHtml(String(r.max))}`).join('<br>');
    details = `<p class="step-sub">Tables</p>${tableLines || '<p class="step-empty">none</p>'}${ranges.length ? `<p class="step-sub">Time ranges</p>${rangeLines}` : ''}`;
  } else {
    summary = '';
    details = `<pre class="step-sql">${escapeHtml(JSON.stringify(step.tool_output, null, 2))}</pre>`;
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'step-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = `<span class="step-caret">&#9654;</span><span class="step-icon">${meta.icon}</span><span class="step-name">${escapeHtml(meta.label)}</span><span class="step-summary">${escapeHtml(summary)}</span><span class="dur">${formatDuration(step.duration_ms)}</span>`;

  const body = document.createElement('div');
  body.className = 'step-body';
  body.innerHTML = details;

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    toggle.querySelector('.step-caret').textContent = !expanded ? '▼' : '▶';
    body.classList.toggle('open', !expanded);
  });

  card.appendChild(toggle);
  card.appendChild(body);
  return card;
}

function updateProgressCard(steps) {
  const card = ensureProgressCard();
  const container = card.querySelector('.progress-steps');
  for (let i = state.renderedStepCount; i < steps.length; i++) {
    container.appendChild(buildStepCard(steps[i]));
  }
  state.renderedStepCount = steps.length;
  card.querySelector('.progress-label').textContent = `Investigating... ${steps.length} step${steps.length === 1 ? '' : 's'}`;
}

/* ---------- Thread view / polling ---------- */

function latestRun(detail) {
  return detail.runs.length > 0 ? detail.runs[detail.runs.length - 1] : null;
}

function renderTerminalAnswer(detail) {
  const run = latestRun(detail);
  const lastMsgRole = detail.messages.length > 0
    ? detail.messages[detail.messages.length - 1].role
    : null;

  if (run && run.status === 'failed' && lastMsgRole === 'user') {
    appendMessage('assistant', `Investigation failed: ${run.error || 'unknown error'}`, { failed: true });
  } else if (run && run.status === 'cancelled' && lastMsgRole === 'user') {
    appendMessage('assistant', 'Investigation stopped by the user.', { failed: true });
  } else if (run && run.status === 'completed' && lastMsgRole === 'user') {
    appendMessage('assistant', run.final_answer || 'No answer generated.', {
      duration: run.duration_ms,
      steps: run.steps,
      sqlQueries: run.sql_queries,
    });
  }
}

function fullRender(detail) {
  setComposerVisible(true);
  clearMessages();
  for (const m of detail.messages) {
    appendMessage(m.role, m.content);
  }
  const run = latestRun(detail);
  if (run && run.status === 'running') {
    updateProgressCard(detail.latestRunSteps || []);
    setComposerEnabled(false);
  } else {
    renderTerminalAnswer(detail);
    setComposerEnabled(true);
  }
}

function incrementalRender(detail) {
  setComposerVisible(true);
  for (let i = state.renderedMessageCount; i < detail.messages.length; i++) {
    appendMessage(detail.messages[i].role, detail.messages[i].content);
  }
  updateProgressCard(detail.latestRunSteps || []);
  setComposerEnabled(false);
}

function renderThread(detail) {
  const stick = isNearBottom();
  const run = latestRun(detail);
  const isNewThread = state.renderedThreadId !== state.activeThreadId;
  const reachedTerminal = state.lastRunStatus === 'running' && run && run.status !== 'running';

  setComposerVisible(true);
  els.input.placeholder = detail.target_database
    ? `Ask about ${detail.target_database}...`
    : 'Ask a question about your database...';
  updateTargetBadge();

  if (isNewThread || reachedTerminal || !run || run.status !== 'running') {
    fullRender(detail);
  } else {
    incrementalRender(detail);
  }

  state.renderedThreadId = state.activeThreadId;
  state.lastRunStatus = run ? run.status : null;
  if (stick) scrollToBottomNow();
}

async function openThread(threadId) {
  stopPolling();
  stopEventStream();
  state.eventStreamOpen = false;
  state.viewGen++;
  state.activeThreadId = threadId;
  state.detail = null;
  state.pendingTarget = null;
  state.draftQuestion = null;
  setComposerVisible(true);
  els.targetBadge.classList.add('hidden');
  els.input.placeholder = 'Ask a question about your database...';
  renderSidebar();
  await pollOnce();
}

async function pollOnce() {
  const gen = state.viewGen;
  if (!state.activeThreadId) return;
  try {
    const { body } = await api(`/threads/${state.activeThreadId}`);
    if (gen !== state.viewGen) return;
    state.detail = body;
    renderThread(body);

    const run = latestRun(body);
    if (run && run.status === 'running') {
      ensureLiveStream();
    } else {
      stopPolling();
      stopEventStream();
      refreshThreads();
    }
  } catch (err) {
    if (gen !== state.viewGen) return;
    appendMessage('assistant', `Failed to load thread: ${err.message}`, { failed: true });
    scrollToBottomNow();
    stopPolling();
  }
}

function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

function stopPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

/* ---------- Live SSE (fetch-based; polling fallback) ---------- */

function stopEventStream() {
  if (state.eventController) {
    state.eventController.abort();
    state.eventController = null;
  }
  state.eventStreamOpen = false;
}

function handleStreamDetail(data) {
  if (!state.eventStreamOpen) return;
  const gen = state.viewGen;
  if (gen !== state.viewGen || !state.activeThreadId) return;
  state.detail = data;
  renderThread(data);
  const run = latestRun(data);
  if (!run || run.status !== 'running') {
    stopEventStream();
    refreshThreads();
  }
}

function startEventStream() {
  stopEventStream();
  if (!state.activeThreadId) return;
  const token = getAuthToken();
  if (!token) {
    startPolling();
    return;
  }

  const controller = new AbortController();
  state.eventController = controller;
  state.eventStreamOpen = true;

  (async () => {
    try {
      const res = await fetch(`/api/threads/${state.activeThreadId}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`stream ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (state.eventStreamOpen) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let event = 'message';
          const dataLines = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            // ':' comments are heartbeats; ignore them.
          }
          if ((event === 'snapshot' || event === 'update') && dataLines.length) {
            try {
              handleStreamDetail(JSON.parse(dataLines.join('\n')));
            } catch { /* ignore malformed payload */ }
          }
        }
      }
    } catch (err) {
      // Abort (intentional close) vs. network error — both just stop the stream.
    } finally {
      if (state.eventController === controller) {
        state.eventController = null;
        state.eventStreamOpen = false;
      }
      // Polling fallback: only if we're still on the same active run.
      const run = state.detail && latestRun(state.detail);
      if (state.activeThreadId && run && run.status === 'running') {
        startPolling();
      }
    }
  })();
}

function ensureLiveStream() {
  if (state.eventStreamOpen) return;
  stopPolling();
  startEventStream();
}

/* ---------- Composer ---------- */

function setComposerEnabled(enabled) {
  els.input.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
}

function setComposerVisible(visible) {
  if (els.composerWrap) {
    els.composerWrap.classList.toggle('hidden', !visible);
  }
}

function buildSelectEmptyHtml() {
  if (state.pendingTarget) {
    const conn = state.connectionsCache.find(c => c.id === state.pendingTarget.connectionId);
    const connName = conn ? escapeHtml(conn.name) : 'your server';
    const db = escapeHtml(state.pendingTarget.database);
    return `
  <div class="empty-state select-state">
    <div class="select-icon-wrap"><span class="select-icon">⬡</span></div>
    <h2>Ready to investigate</h2>
    <p>Target: <strong>${db}</strong> on <strong>${connName}</strong></p>
    <p class="select-hint">Type your question below to start — the agent will query <code>${db}</code>.</p>
    <div class="example-questions" style="margin-top:16px">
      <button class="example-btn">Why did orders from Russia stop recently?</button>
      <button class="example-btn">Why are payment failures spiking?</button>
      <button class="example-btn">Which products saw an unusual surge in sales?</button>
    </div>
  </div>`;
  }
  if (state.threads.length === 0) {
    return `
  <div class="empty-state select-state">
    <div class="select-icon-wrap"><span class="select-icon">◈</span></div>
    <h2>Welcome to Whybase</h2>
    <p>No investigations yet.<br>Create your first one to start querying.</p>
    <button class="primary-btn select-cta" id="empty-new-investigation">+ New Investigation</button>
    <p class="select-hint">Each investigation is tied to a MySQL database — you'll pick the server &amp; database first.</p>
  </div>`;
  }
  return `
  <div class="empty-state select-state">
    <div class="select-icon-wrap"><span class="select-icon">◈</span></div>
    <h2>Select an investigation</h2>
    <p>Pick a thread from the sidebar<br>or start a fresh investigation.</p>
    <button class="primary-btn select-cta" id="empty-new-investigation">+ New Investigation</button>
    <p class="select-hint">Tip: click a thread on the left to continue, or create a new one.</p>
  </div>`;
}

const EMPTY_STATE_HTML = buildSelectEmptyHtml();

function renderEmptyState() {
  const html = buildSelectEmptyHtml();
  els.messages.innerHTML = html;
  // bind CTA and examples inside empty state
  const cta = document.getElementById('empty-new-investigation');
  if (cta) cta.addEventListener('click', () => openNewChatWizard());
  bindExampleButtons();
}

function newThread() {
  stopPolling();
  stopEventStream();
  state.viewGen++;
  state.activeThreadId = null;
  state.detail = null;
  state.renderedThreadId = null;
  state.lastRunStatus = null;
  // Starting fresh: clear any pending target/draft (they're only kept via wizard flow)
  state.pendingTarget = null;
  state.draftQuestion = null;
  renderEmptyState();
  renderSidebar();
  updateTargetBadge();
  // Composer: hidden until a thread is selected or a target is chosen via wizard
  if (state.pendingTarget) {
    setComposerVisible(true);
    setComposerEnabled(true);
    els.input.placeholder = `Ask about ${state.pendingTarget.database}...`;
    els.input.value = state.draftQuestion || '';
    els.input.focus();
  } else {
    setComposerVisible(false);
    setComposerEnabled(false);
    els.input.placeholder = 'Select an investigation to begin…';
    els.input.value = '';
  }
}

async function submitQuestion(event) {
  event.preventDefault();
  const question = els.input.value.trim();
  if (!question) return;

  if (!state.activeThreadId) {
    const target = state.pendingTarget;
    if (!target || !target.connectionId || !target.database) {
      state.pendingTarget = null;
      state.draftQuestion = question;
      openNewChatWizard();
      return;
    }
  }

  els.input.value = '';
  els.input.style.height = 'auto';
  setComposerEnabled(false);

  try {
    const payload = { question };
    if (!state.activeThreadId && state.pendingTarget?.connectionId && state.pendingTarget?.database) {
      payload.connectionId = state.pendingTarget.connectionId;
      payload.database = state.pendingTarget.database;
    }
    const path = state.activeThreadId
      ? `/threads/${state.activeThreadId}/messages`
      : '/threads';
    const { body } = await api(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.activeThreadId = body.threadId;
    state.pendingTarget = null;
    await refreshThreads();
    await pollOnce();
  } catch (err) {
    appendMessage('assistant', err.message, { failed: true });
    scrollToBottomNow();
    setComposerEnabled(true);
  }
}

function autoGrow() {
  if (!els.input) return;
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
}

function onComposerKeydown(event) {
  if (event.key !== 'Enter') return;
  // Allow IME composition (e.g. CJK) to complete naturally.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.shiftKey) {
    // Shift+Enter -> newline, then let the default insert happen and re-grow.
    requestAnimationFrame(autoGrow);
    return;
  }
  event.preventDefault();
  if (!els.input.disabled && !els.sendBtn.disabled) {
    els.form.requestSubmit();
  }
}

function onGlobalKeydown(event) {
  if (event.key === 'Escape' && els.logoutModal && !els.logoutModal.classList.contains('hidden')) {
    closeLogoutModal();
    return;
  }
  const mod = event.ctrlKey || event.metaKey;
  if (mod && (event.key === 'n' || event.key === 'N')) {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
    // Allow the browser's native "new window" only when typing in a field; otherwise new thread.
    if (!editing) {
      event.preventDefault();
      newThread();
      openNewChatWizard();
    }
  }
}

/* ---------- Health ---------- */

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    els.healthDot.className = `health-dot ${res.ok ? 'ok' : 'down'}`;
  } catch {
    els.healthDot.className = 'health-dot down';
  }
}

/* ---------- New-chat target wizard ---------- */

function updateTargetBadge() {
  let text = null;
  if (state.activeThreadId && state.detail?.target_database) {
    const conn = state.connectionsCache.find(c => c.id === state.detail.connection_id);
    text = conn ? `${state.detail.target_database} · ${conn.name}` : state.detail.target_database;
  } else if (!state.activeThreadId && state.pendingTarget) {
    const conn = state.connectionsCache.find(c => c.id === state.pendingTarget.connectionId);
    text = conn ? `${state.pendingTarget.database} · ${conn.name}` : state.pendingTarget.database;
  }
  if (text) {
    els.targetBadge.innerHTML = `<span class="badge-label">Investigating</span> ${escapeHtml(text)}`;
    els.targetBadge.classList.remove('hidden');
  } else {
    els.targetBadge.classList.add('hidden');
  }
}

async function cacheConnections() {
  try {
    const { body } = await api('/connections');
    state.connectionsCache = body;
  } catch { /* badge falls back to database-only label */ }
}

function showWizardStep(step) {
  els.wizardStepConnection.classList.toggle('hidden', step !== 'connection');
  els.wizardStepDatabase.classList.toggle('hidden', step !== 'database');
  els.wizardTitle.textContent = step === 'connection'
    ? 'Choose a MySQL server'
    : `Choose a database on “${wizardConnectionName()}”`;
}

function wizardConnectionName() {
  return state.connectionsCache.find(c => c.id === state.wizardConnectionId)?.name || 'server';
}

function openNewChatWizard() {
  els.addConnectionForm.classList.add('hidden');
  els.toggleAddConnection.classList.remove('hidden');
  state.wizardConnectionId = null;
  showWizardStep('connection');
  els.newChatModal.classList.remove('hidden');
  renderWizardConnections();
}

function closeNewChatWizard() {
  els.newChatModal.classList.add('hidden');
}

async function renderWizardConnections() {
  els.connectionsList.innerHTML = '<li class="conn-empty">Loading…</li>';
  try {
    await cacheConnections();
    if (!state.connectionsCache.length) {
      els.connectionsList.innerHTML = '';
      els.firstRunBanner.classList.remove('hidden');
      return;
    }
    els.firstRunBanner.classList.add('hidden');
    let health = {};
    try {
      const { body } = await api('/connections/health');
      for (const h of (body.connections || [])) health[h.id] = h.healthy;
    } catch { /* indicators degrade gracefully */ }

    els.connectionsList.innerHTML = '';
    for (const c of state.connectionsCache) {
      const li = document.createElement('li');
      li.className = 'conn-item clickable';
      const isHealthy = health[c.id];
      const healthClass = isHealthy === undefined ? 'unknown' : (isHealthy ? 'ok' : 'down');
      li.innerHTML = `
        <span class="conn-health conn-health-${healthClass}" title="${isHealthy === undefined ? 'Health unknown' : (isHealthy ? 'Online' : 'Unreachable')}"></span>
        <div class="conn-info">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.user)}@${escapeHtml(c.host)}:${c.port} · ${lastUsedLabel(c.last_used_at)}</span>
        </div>
        <div class="conn-actions">
          <button type="button" class="sample-btn" title="Create a sample dataset on this server">Sample</button>
          <button type="button" class="icon-btn conn-delete" title="Delete connection">&times;</button>
          <span class="chevron">&#8250;</span>
        </div>`;
      li.addEventListener('click', () => selectWizardConnection(c.id));
      li.querySelector('.sample-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        useSampleDataset(c.id);
      });
      li.querySelector('.conn-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete connection "${c.name}"? Existing chats bound to it will fail.`)) return;
        try {
          await api(`/connections/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
          await renderWizardConnections();
          updateTargetBadge();
        } catch (err) {
          alert(err.message);
        }
      });
      els.connectionsList.appendChild(li);
    }
  } catch (err) {
    els.connectionsList.innerHTML = `<li class="conn-empty">${escapeHtml(err.message)}</li>`;
  }
}

function lastUsedLabel(lastUsedAt) {
  if (!lastUsedAt) return 'never used';
  const diff = Date.now() - new Date(lastUsedAt).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'used just now';
  if (min < 60) return `used ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `used ${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `used ${day}d ago`;
}

async function selectWizardConnection(connectionId) {
  state.wizardConnectionId = connectionId;
  showWizardStep('database');
  els.exploreSchema.classList.add('hidden');
  els.exploreSchema.innerHTML = '';
  els.exploreSchemaToggle.setAttribute('aria-pressed', 'false');
  els.exploreSchemaCaret.textContent = '▶';
  els.databaseList.innerHTML = '<li class="db-empty">Loading databases…</li>';
  try {
    const { body } = await api(`/connections/${encodeURIComponent(connectionId)}/databases`);
    const dbs = body.databases || [];
    if (!dbs.length) {
      els.databaseList.innerHTML = '<li class="db-empty">No databases visible for this user.</li>';
      return;
    }
    els.databaseList.innerHTML = '';
    for (const db of dbs) {
      const li = document.createElement('li');
      li.className = 'db-item';
      li.innerHTML = `
        <span class="db-icon">&#128451;</span>
        <span class="db-name">${escapeHtml(db)}</span>
        <span class="chevron">&#8250;</span>`;
      li.addEventListener('click', () => chooseDatabase(db));
      els.databaseList.appendChild(li);
    }
  } catch (err) {
    els.databaseList.innerHTML = `<li class="db-empty">${escapeHtml(err.message)}</li>`;
  }
}

function chooseDatabase(database) {
  if (!state.wizardConnectionId || !database) return;
  state.pendingTarget = { connectionId: state.wizardConnectionId, database };
  closeNewChatWizard();
  updateTargetBadge();
  // switch to ready empty state and expose composer
  renderEmptyState();
  setComposerVisible(true);
  setComposerEnabled(true);
  els.input.placeholder = `Ask about ${database}...`;
  els.input.focus();
  // re-bind examples inside the new empty state
  if (state.draftQuestion) {
    els.input.value = state.draftQuestion;
    state.draftQuestion = null;
    // small delay so user sees the target badge before auto-submit
    setTimeout(() => els.form.dispatchEvent(new Event('submit')), 80);
  }
}

async function useSampleDataset(connectionId) {
  if (!confirm('Create a fresh sample dataset (traceiq_sample) with orders, customers, and products on this server?')) return;
  try {
    const { status, body } = await api(`/connections/${encodeURIComponent(connectionId)}/sample-dataset`, { method: 'POST' });
    if (status !== 201) throw new Error(body.error || 'Could not create sample dataset');
    alert(`Sample dataset "${body.database}" ready.`);
    if (state.wizardConnectionId === connectionId) {
      await selectWizardConnection(connectionId);
      const dbEls = els.databaseList.querySelectorAll('.db-item');
      for (const el of dbEls) {
        if (el.querySelector('.db-name').textContent === body.database) {
          chooseDatabase(body.database);
          return;
        }
      }
    }
  } catch (err) {
    alert(err.message);
  }
}

async function loadExploreSchema(connectionId) {
  els.exploreSchema.innerHTML = '<p class="conn-empty">Loading schema…</p>';
  try {
    const { body } = await api(`/connections/${encodeURIComponent(connectionId)}/schema`);
    if (!body.tables || !body.tables.length) {
      els.exploreSchema.innerHTML = '<p class="conn-empty">No tables found.</p>';
      return;
    }
    els.exploreSchema.innerHTML = '';
    body.tables.forEach(t => {
      const group = document.createElement('div');
      group.className = 'schema-group';
      group.innerHTML = `
        <button type="button" class="schema-table-toggle" aria-expanded="false">
          <span class="step-caret">&#9654;</span>
          <span class="schema-table-name">${escapeHtml(t.schema)}.${escapeHtml(t.name)}</span>
          <span class="schema-col-count">${t.columns.length} col${t.columns.length === 1 ? '' : 's'}</span>
        </button>
        <div class="schema-columns hidden"></div>`;
      const bodyDiv = group.querySelector('.schema-columns');
      bodyDiv.innerHTML = t.columns.map(c => `
        <div class="schema-col">
          <span class="schema-col-name">${escapeHtml(c.name)}</span>
          <span class="schema-col-type">${escapeHtml(c.type)}</span>
          ${c.key ? `<span class="schema-col-key">${escapeHtml(c.key)}</span>` : ''}
          ${c.nullable ? '' : '<span class="schema-col-notnull">NOT NULL</span>'}
        </div>`).join('');
      group.querySelector('.schema-table-toggle').addEventListener('click', () => {
        const toggle = group.querySelector('.schema-table-toggle');
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        toggle.querySelector('.step-caret').textContent = !expanded ? '▼' : '▶';
        bodyDiv.classList.toggle('hidden', expanded);
      });
      els.exploreSchema.appendChild(group);
    });
  } catch (err) {
    els.exploreSchema.innerHTML = `<p class="conn-empty">${escapeHtml(err.message)}</p>`;
  }
}

async function submitConnection(event) {
  event.preventDefault();
  const btn = document.getElementById('add-connection-submit');
  const payload = {
    name: document.getElementById('conn-name').value.trim(),
    host: document.getElementById('conn-host').value.trim(),
    port: Number(document.getElementById('conn-port').value) || 3306,
    user: document.getElementById('conn-user').value.trim(),
    password: document.getElementById('conn-password').value,
  };
  btn.disabled = true;
  btn.textContent = 'Testing connection…';
  try {
    const { body } = await api('/connections', { method: 'POST', body: JSON.stringify(payload) });
    els.addConnectionForm.reset();
    document.getElementById('conn-port').value = '3306';
    els.addConnectionForm.classList.add('hidden');
    els.toggleAddConnection.classList.remove('hidden');
    await renderWizardConnections();
    await selectWizardConnection(body.id);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect server';
  }
}

/* ---------- Theme ---------- */

const THEME_KEY = 'traceiq-theme';
const THEME_ICONS = { dark: '&#9680;', light: '&#9681;' };

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  els.themeToggle.innerHTML = THEME_ICONS[theme];
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
  els.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

/* ---------- Mobile sidebar ---------- */

function closeSidebar() {
  els.sidebar.classList.remove('open');
  els.sidebarBackdrop.classList.remove('show');
  els.sidebarBackdrop.classList.add('hidden');
}

function initMobile() {
  els.sidebarToggle.addEventListener('click', () => {
    const open = els.sidebar.classList.toggle('open');
    if (open) {
      els.sidebarBackdrop.classList.remove('hidden');
      requestAnimationFrame(() => els.sidebarBackdrop.classList.add('show'));
    } else {
      closeSidebar();
    }
  });
  els.sidebarBackdrop.addEventListener('click', closeSidebar);
  const match = window.matchMedia('(min-width: 761px)');
  match.addEventListener && match.addEventListener('change', (e) => { if (e.matches) closeSidebar(); });
}

/* ---------- Wiring ---------- */

function bindExampleButtons() {
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.input.value = btn.textContent;
      els.form.dispatchEvent(new Event('submit'));
    });
  });
}

els.messages.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const id = btn.getAttribute('data-copy');
  if (!id) return;
  const block = document.getElementById(id);
  const text = block ? block.querySelector('pre').innerText : '';
  navigator.clipboard && navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  });
});
els.newThreadBtn.addEventListener('click', () => {
  newThread();
  openNewChatWizard();
});
els.form.addEventListener('submit', submitQuestion);
els.input.addEventListener('input', autoGrow);
els.input.addEventListener('keydown', onComposerKeydown);
els.closeNewChatModal.addEventListener('click', closeNewChatWizard);
els.newChatModal.addEventListener('click', (e) => {
  if (e.target === els.newChatModal) closeNewChatWizard();
});
els.toggleAddConnection.addEventListener('click', () => {
  els.addConnectionForm.classList.toggle('hidden');
  els.toggleAddConnection.classList.toggle('hidden');
});
els.wizardBack.addEventListener('click', () => {
  state.wizardConnectionId = null;
  showWizardStep('connection');
});
els.exploreSchemaToggle.addEventListener('click', () => {
  if (!state.wizardConnectionId) return;
  const closing = els.exploreSchema.classList.contains('hidden') === false;
  if (closing) {
    els.exploreSchema.classList.add('hidden');
    els.exploreSchemaCaret.textContent = '▶';
    els.exploreSchemaToggle.setAttribute('aria-pressed', 'false');
  } else {
    els.exploreSchema.classList.remove('hidden');
    els.exploreSchemaCaret.textContent = '▼';
    els.exploreSchemaToggle.setAttribute('aria-pressed', 'true');
    loadExploreSchema(state.wizardConnectionId);
  }
});
els.addConnectionForm.addEventListener('submit', submitConnection);
// Sign out: modal with confirm + loading + toast
els.logoutBtn.addEventListener('click', () => openLogoutModal());
els.logoutCancel?.addEventListener('click', () => closeLogoutModal());
els.logoutConfirm?.addEventListener('click', () => performLogout());
els.logoutModal?.addEventListener('click', (e) => { if (e.target === els.logoutModal) closeLogoutModal(); });
document.addEventListener('keydown', onGlobalKeydown);
els.authForm.addEventListener('submit', submitAuth);
els.authSwitch.addEventListener('click', (e) => {
  e.preventDefault();
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});

// ---------- OTP email verification ----------
els.otpForm.addEventListener('submit', submitOtp);
els.otpResend.addEventListener('click', resendOtp);
els.otpBack.addEventListener('click', (e) => {
  e.preventDefault();
  showAuthView();
});
els.otpCode.addEventListener('input', () => {
  els.otpCode.value = els.otpCode.value.replace(/\D/g, '').slice(0, 6);
  if (els.otpError.textContent) els.otpError.textContent = '';
});

// ---------- First-login Groq setup ----------
function groqSetupErrorText(msg) {
  els.groqSetupError.textContent = msg;
}

els.groqSetupLink?.addEventListener('click', (e) => {
  e.preventDefault();
  window.open('https://console.groq.com', '_blank', 'noopener');
});

els.groqSetupVerify?.addEventListener('click', async () => {
  const key = els.groqSetupKey.value.trim();
  if (!key) {
    els.groqSetupError.classList.add('shake');
    groqSetupErrorText('Enter your Groq API key first.');
    els.groqSetupKey.focus();
    setTimeout(() => els.groqSetupError.classList.remove('shake'), 400);
    return;
  }
  els.groqSetupVerify.disabled = true;
  els.groqSetupVerify.textContent = 'Verifying…';
  try {
    const { body } = await api('/settings/groq/verify', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
    if (body.ok) {
      els.groqSetupError.textContent = '';
      showToast('Key is valid', 'ok');
    } else {
      groqSetupErrorText(body.error || 'Key verification failed');
    }
  } catch (err) {
    groqSetupErrorText(err.message);
  } finally {
    els.groqSetupVerify.disabled = false;
    els.groqSetupVerify.textContent = 'Verify key';
  }
});

els.groqSetupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = els.groqSetupKey.value.trim();
  if (!key) {
    els.groqSetupError.classList.add('shake');
    groqSetupErrorText('Enter your Groq API key first.');
    els.groqSetupKey.focus();
    setTimeout(() => els.groqSetupError.classList.remove('shake'), 400);
    return;
  }
  if (key.length < 10) {
    els.groqSetupError.classList.add('shake');
    groqSetupErrorText('That key looks too short.');
    els.groqSetupKey.focus();
    setTimeout(() => els.groqSetupError.classList.remove('shake'), 400);
    return;
  }
  els.groqSetupSubmit.disabled = true;
  els.groqSetupSubmit.textContent = 'Connecting…';
  try {
    const { body } = await api('/settings/groq', { method: 'PUT', body: JSON.stringify({ apiKey: key }) });
    if (!body.ok) return groqSetupErrorText('Failed to save your key.');
    const me = await api('/auth/me');
    updateSidebarUser(me.body);
    enterApp();
  } catch (err) {
    groqSetupErrorText(err.message);
    els.groqSetupSubmit.disabled = false;
    els.groqSetupSubmit.textContent = 'Connect & continue';
  }
});

checkHealth();
setInterval(checkHealth, 30000);
initTheme();
initMobile();
initSession();
