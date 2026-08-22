const POLL_INTERVAL_MS = 2000;
const NEAR_BOTTOM_THRESHOLD_PX = 80;

const els = {
  threadList: document.getElementById('thread-list'),
  newThreadBtn: document.getElementById('new-thread-btn'),
  messages: document.getElementById('messages'),
  form: document.getElementById('ask-form'),
  input: document.getElementById('question-input'),
  sendBtn: document.getElementById('send-btn'),
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
};

let state = {
  threads: [],
  activeThreadId: null,
  detail: null,
  pollTimer: null,
  renderedThreadId: null,
  renderedMessageCount: 0,
  renderedStepCount: 0,
  lastRunStatus: null,
  pendingTarget: null,
  draftQuestion: null,
  wizardConnectionId: null,
  connectionsCache: [],
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

function renderRichText(text) {
  const lines = escapeHtml(text).split('\n');
  let html = '';
  let inList = false;
  let i = 0;

  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('|')) {
      closeList();
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('|')) j++;
      html += buildTable(lines.slice(i, j));
      i = j;
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineFormat(bullet[1])}</li>`;
    } else {
      closeList();
      if (line.trim()) html += `<p>${inlineFormat(line)}</p>`;
    }
    i++;
  }
  closeList();
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
      <span class="thread-title">${escapeHtml(t.title)}</span>
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
    const { body } = await api('/threads');
    state.threads = body;
    renderSidebar();
  } catch { /* sidebar refresh is best-effort */ }
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

/* ---------- Progress card ---------- */

function ensureProgressCard() {
  let card = document.getElementById('progress-card');
  if (!card) {
    card = document.createElement('div');
    card.className = 'msg assistant';
    card.id = 'progress-card';
    card.innerHTML = `
      <div class="progress-card">
        <div class="progress-header"><span class="spinner"></span> <span class="progress-label">Investigating...</span></div>
        <ul class="step-list"></ul>
      </div>`;
    messagesInner().appendChild(card);
    state.renderedStepCount = 0;
  }
  return card;
}

function updateProgressCard(steps) {
  const card = ensureProgressCard();
  const ul = card.querySelector('.step-list');
  for (let i = state.renderedStepCount; i < steps.length; i++) {
    const s = steps[i];
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="tool">${escapeHtml(s.tool_name)}</span>
      ${s.tool_input?.sql ? escapeHtml(String(s.tool_input.sql).substring(0, 60)) : ''}
      <span class="dur">${formatDuration(s.duration_ms)}</span>`;
    ul.appendChild(li);
  }
  state.renderedStepCount = steps.length;
  card.querySelector('.progress-label').textContent = `Investigating... ${steps.length} step(s)`;
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
  } else if (run && run.status === 'completed' && lastMsgRole === 'user') {
    appendMessage('assistant', run.final_answer || 'No answer generated.', {
      duration: run.duration_ms,
      steps: run.steps,
      sqlQueries: run.sql_queries,
    });
  }
}

function fullRender(detail) {
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

  if (detail.target_database) {
    els.input.placeholder = `Ask about ${detail.target_database}...`;
  }
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

    if (latestRun(body)?.status !== 'running') {
      stopPolling();
      refreshThreads();
    }
  } catch (err) {
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

/* ---------- Composer ---------- */

function setComposerEnabled(enabled) {
  els.input.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
}

const EMPTY_STATE_HTML = `
  <div class="empty-state">
    <h2>Investigate your database</h2>
    <p>Ask why a metric changed, which segment is affected, or what is driving a trend.<br>TraceIQ explores the data and reports findings with evidence.</p>
    <div class="example-questions">
      <button class="example-btn">Why did orders from Russia stop recently?</button>
      <button class="example-btn">Why are payment failures spiking? Are certain user groups affected more?</button>
      <button class="example-btn">Which products saw an unusual surge in sales?</button>
    </div>
  </div>`;

function newThread() {
  stopPolling();
  state.activeThreadId = null;
  state.detail = null;
  state.renderedThreadId = null;
  state.lastRunStatus = null;
  state.pendingTarget = null;
  state.draftQuestion = null;
  els.messages.innerHTML = EMPTY_STATE_HTML;
  bindExampleButtons();
  renderSidebar();
  setComposerEnabled(true);
  updateTargetBadge();
  els.input.placeholder = 'Ask a question about your database...';
  els.input.value = '';
  els.input.focus();
}

async function submitQuestion(event) {
  event.preventDefault();
  const question = els.input.value.trim();
  if (!question) return;

  if (!state.activeThreadId && !state.pendingTarget) {
    state.draftQuestion = question;
    openNewChatWizard();
    return;
  }

  els.input.value = '';
  els.input.style.height = 'auto';
  setComposerEnabled(false);

  try {
    const payload = { question };
    if (!state.activeThreadId && state.pendingTarget) {
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
    startPolling();
  } catch (err) {
    appendMessage('assistant', err.message, { failed: true });
    scrollToBottomNow();
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
      els.connectionsList.innerHTML = '<li class="conn-empty">No MySQL servers yet. Add one below to get started.</li>';
      return;
    }
    els.connectionsList.innerHTML = '';
    for (const c of state.connectionsCache) {
      const li = document.createElement('li');
      li.className = 'conn-item clickable';
      li.innerHTML = `
        <div class="conn-info">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.user)}@${escapeHtml(c.host)}:${c.port}</span>
        </div>
        <div class="conn-actions">
          <button type="button" class="icon-btn conn-delete" title="Delete connection">&times;</button>
          <span class="chevron">&#8250;</span>
        </div>`;
      li.addEventListener('click', () => selectWizardConnection(c.id));
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

async function selectWizardConnection(connectionId) {
  state.wizardConnectionId = connectionId;
  showWizardStep('database');
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
  state.pendingTarget = { connectionId: state.wizardConnectionId, database };
  closeNewChatWizard();
  updateTargetBadge();
  els.input.placeholder = `Ask about ${database}...`;
  els.input.focus();
  if (state.draftQuestion) {
    els.input.value = state.draftQuestion;
    state.draftQuestion = null;
    els.form.dispatchEvent(new Event('submit'));
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

/* ---------- Wiring ---------- */

function bindExampleButtons() {
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.input.value = btn.textContent;
      els.form.dispatchEvent(new Event('submit'));
    });
  });
}

els.newThreadBtn.addEventListener('click', () => {
  newThread();
  openNewChatWizard();
});
els.form.addEventListener('submit', submitQuestion);
els.input.addEventListener('input', autoGrow);
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
els.addConnectionForm.addEventListener('submit', submitConnection);

checkHealth();
setInterval(checkHealth, 30000);
refreshThreads();
cacheConnections();
newThread();
