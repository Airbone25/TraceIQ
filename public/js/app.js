const POLL_INTERVAL_MS = 2000;

const els = {
  threadList: document.getElementById('thread-list'),
  newThreadBtn: document.getElementById('new-thread-btn'),
  messages: document.getElementById('messages'),
  form: document.getElementById('ask-form'),
  input: document.getElementById('question-input'),
  sendBtn: document.getElementById('send-btn'),
  healthDot: document.getElementById('health-dot'),
};

let state = {
  threads: [],
  activeThreadId: null,
  detail: null,
  pollTimer: null,
};

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new Error(body.error || `Request failed (${res.status})`);
  return { ok: res.ok, status: res.status, body };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function inlineFormat(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderRichText(text) {
  const lines = escapeHtml(text).split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineFormat(bullet[1])}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += `<p>${inlineFormat(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function formatDuration(ms) {
  if (ms == null) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/* ---------- Sidebar ---------- */

function renderSidebar() {
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
      <span class="thread-title">${escapeHtml(t.title)}</span>`;
    li.addEventListener('click', () => openThread(t.id));
    els.threadList.appendChild(li);
  }
}

async function refreshThreads() {
  try {
    const { body } = await api('/threads');
    state.threads = body;
    renderSidebar();
  } catch { /* sidebar refresh is best-effort */ }
}

/* ---------- Messages ---------- */

function clearMessages() {
  els.messages.innerHTML = '<div class="messages-inner" id="messages-inner"></div>';
}

function messagesInner() {
  let inner = document.getElementById('messages-inner');
  if (!inner) {
    els.messages.innerHTML = '<div class="messages-inner" id="messages-inner"></div>';
    inner = document.getElementById('messages-inner');
  }
  return inner;
}

function scrollBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function addMessageBubble(role, content, meta) {
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
  messagesInner().appendChild(msg);
  scrollBottom();
}

function renderProgressCard(steps) {
  const existing = document.getElementById('progress-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'msg assistant';
  card.id = 'progress-card';
  const items = steps.map(s => `
    <li>
      <span class="tool">${escapeHtml(s.tool_name)}</span>
      ${s.tool_input?.sql ? escapeHtml(String(s.tool_input.sql).substring(0, 60)) : ''}
      <span class="dur">${formatDuration(s.duration_ms)}</span>
    </li>`).join('');
  card.innerHTML = `
    <div class="progress-card">
      <div class="progress-header"><span class="spinner"></span> Investigating... ${steps.length} step(s)</div>
      <ul class="step-list">${items}</ul>
    </div>`;
  messagesInner().appendChild(card);
  scrollBottom();
}

function removeProgressCard() {
  document.getElementById('progress-card')?.remove();
}

/* ---------- Thread view / polling ---------- */

function latestRun(detail) {
  return detail.runs.length > 0 ? detail.runs[detail.runs.length - 1] : null;
}

function renderThread(detail) {
  clearMessages();
  for (const m of detail.messages) {
    addMessageBubble(m.role, m.content);
  }

  const run = latestRun(detail);
  const lastMsgRole = detail.messages.length > 0
    ? detail.messages[detail.messages.length - 1].role
    : null;

  if (run && run.status === 'running') {
    renderProgressCard(detail.latestRunSteps || []);
    setComposerEnabled(false);
  } else {
    removeProgressCard();
    if (run && run.status === 'failed' && lastMsgRole === 'user') {
      addMessageBubble('assistant', `Investigation failed: ${run.error || 'unknown error'}`, { failed: true });
    } else if (run && run.status === 'completed' && lastMsgRole === 'user') {
      addMessageBubble('assistant', run.final_answer || 'No answer generated.', {
        duration: run.duration_ms,
        steps: run.steps,
        sqlQueries: run.sql_queries,
      });
    }
    setComposerEnabled(true);
  }
}

async function openThread(threadId) {
  stopPolling();
  state.activeThreadId = threadId;
  renderSidebar();
  await pollOnce();
  startPolling();
}

async function pollOnce() {
  if (!state.activeThreadId) return;
  try {
    const { body } = await api(`/threads/${state.activeThreadId}`);
    state.detail = body;
    renderThread(body);

    const running = latestRun(body)?.status === 'running';
    if (!running) {
      stopPolling();
      refreshThreads();
    }
  } catch (err) {
    addMessageBubble('assistant', `Failed to load thread: ${err.message}`, { failed: true });
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

/* ---------- Composer ---------- */

function setComposerEnabled(enabled) {
  els.input.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
}

function newThread() {
  stopPolling();
  state.activeThreadId = null;
  state.detail = null;
  clearMessages();
  els.messages.innerHTML = `
    <div class="empty-state">
      <h2>Investigate your database</h2>
      <p>Ask why a metric changed, which segment is affected, or what is driving a trend.<br>TraceIQ explores the data and reports findings with evidence.</p>
      <div class="example-questions">
        <button class="example-btn">Why did orders from Russia stop recently?</button>
        <button class="example-btn">Why are payment failures spiking? Are certain user groups affected more?</button>
        <button class="example-btn">Which products saw an unusual surge in sales?</button>
      </div>
    </div>`;
  bindExampleButtons();
  renderSidebar();
  setComposerEnabled(true);
  els.input.focus();
}

async function submitQuestion(event) {
  event.preventDefault();
  const question = els.input.value.trim();
  if (!question) return;

  els.input.value = '';
  els.input.style.height = 'auto';

  if (document.querySelector('.empty-state')) {
    document.querySelector('.empty-state').remove();
  }
  addMessageBubble('user', question);
  setComposerEnabled(false);

  try {
    const path = state.activeThreadId
      ? `/threads/${state.activeThreadId}/messages`
      : '/threads';
    const { body } = await api(path, {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
    state.activeThreadId = body.threadId;
    await refreshThreads();
    await pollOnce();
    startPolling();
  } catch (err) {
    addMessageBubble('assistant', err.message, { failed: true });
    setComposerEnabled(true);
  }
}

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
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

/* ---------- Wiring ---------- */

function bindExampleButtons() {
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.input.value = btn.textContent;
      els.form.dispatchEvent(new Event('submit'));
    });
  });
}

els.newThreadBtn.addEventListener('click', newThread);
els.form.addEventListener('submit', submitQuestion);
els.input.addEventListener('input', autoGrow);
bindExampleButtons();

checkHealth();
setInterval(checkHealth, 30000);
refreshThreads();
newThread();
