// Additive cloud client for the TraceIQ cloud API (MongoDB Atlas backed).
//
// This module encodes the full cloud API contract so the desktop backend can
// delegate product-data operations (auth, Groq keys, saved connections,
// threads, messages, investigations) to the cloud service when the switchover
// happens. It is intentionally self-contained and independent: the running
// local app does not depend on it yet, so nothing breaks until we point the
// stores at it.
//
// Auth model: the Electron renderer keeps the JWT in `localStorage` and hands
// it to this client through the injected `getToken` provider. Every
// authenticated request sends `Authorization: Bearer <token>`.

const DEFAULT_BASE_URL = process.env.CLOUD_API_BASE_URL || 'http://localhost:4000';

export class CloudApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function normalizeError(err) {
  if (err instanceof CloudApiError) return err;
  return new CloudApiError(err.message || 'Cloud API request failed');
}

export class CloudClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, getToken = null, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.getToken = getToken;
    this.fetchImpl = fetchImpl;
  }

  setTokenProvider(getToken) {
    this.getToken = getToken;
  }

  // Return a cloud client bound to a specific token (used by the local backend
  // to act on behalf of an authenticated user whose JWT it captured).
  forToken(token) {
    return new CloudClient({
      baseUrl: this.baseUrl,
      getToken: () => token,
      fetchImpl: this.fetchImpl,
    });
  }

  async request(method, path, { body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = typeof this.getToken === 'function' ? this.getToken() : null;
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw normalizeError(err);
    }

    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const parsed = isJson || res.status === 0 ? await res.json().catch(() => ({})) : await res.text().catch(() => '');
    if (!res.ok) {
      throw new CloudApiError(
        (parsed && parsed.error) || `Cloud API request failed (${res.status})`,
        { status: res.status, code: parsed && parsed.code, body: parsed }
      );
    }
    return parsed;
  }

  /* ---------- Auth ---------- */

  async register({ email, password }) {
    return this.request('POST', '/auth/register', { body: { email, password }, auth: false });
  }

  async login({ email, password }) {
    return this.request('POST', '/auth/login', { body: { email, password }, auth: false });
  }

  async logout() {
    return this.request('POST', '/auth/logout', { body: {} });
  }

  async me() {
    return this.request('GET', '/auth/me');
  }

  async deleteAccount() {
    return this.request('DELETE', '/account', { body: {} });
  }

  async updateAccount({ currentPassword, email, newPassword }) {
    return this.request('PATCH', '/account', { body: { currentPassword, email, newPassword } });
  }

  /* ---------- Groq / block keys ---------- */

  async getKeys() {
    return this.request('GET', '/keys');
  }

  async updateKeys({ apiKey, model } = {}) {
    return this.request('PUT', '/keys', { body: { apiKey, model } });
  }

  async verifyKey(apiKey) {
    return this.request('POST', '/keys/verify', { body: { apiKey } });
  }

  async getActiveGroqKey() {
    return this.request('GET', '/keys/active');
  }

  /* ---------- Saved connections ---------- */

  async listConnections() {
    return this.request('GET', '/connections');
  }

  async getConnection(id) {
    return this.request('GET', `/connections/${encodeURIComponent(id)}`);
  }

  async createConnection({ name, host, port = 3306, user, password, useSsl = false }) {
    return this.request('POST', '/connections', { body: { name, host, port, user, password, useSsl } });
  }

  async touchConnection(id) {
    return this.request('POST', `/connections/${encodeURIComponent(id)}/touch`, { body: {} });
  }

  async getConnectionCredentials(id) {
    return this.request('GET', `/connections/${encodeURIComponent(id)}/credentials`);
  }

  async deleteConnection(id) {
    return this.request('DELETE', `/connections/${encodeURIComponent(id)}`, { body: {} });
  }

  /* ---------- Threads / messages ---------- */

  async listThreads() {
    return this.request('GET', '/threads');
  }

  async createThread({ question, connectionId = null, database = null }) {
    return this.request('POST', '/threads', { body: { question, connectionId, database } });
  }

  async getThread(id) {
    return this.request('GET', `/threads/${encodeURIComponent(id)}`);
  }

  async getThreadContext(id, turns = 3) {
    return this.request('GET', `/threads/${encodeURIComponent(id)}/context?turns=${encodeURIComponent(turns)}`);
  }

  async addFollowUp(id, question) {
    return this.request('POST', `/threads/${encodeURIComponent(id)}/messages`, { body: { question } });
  }

  async addAssistantMessage(id, content) {
    return this.request('POST', `/threads/${encodeURIComponent(id)}/messages/assistant`, { body: { content } });
  }

  async deleteThread(id) {
    return this.request('DELETE', `/threads/${encodeURIComponent(id)}`, { body: {} });
  }

  /* ---------- Investigations ---------- */

  async listInvestigations() {
    return this.request('GET', '/investigations');
  }

  async getInvestigation(id) {
    return this.request('GET', `/investigations/${encodeURIComponent(id)}`);
  }

  async addStep(id, step) {
    return this.request('POST', `/investigations/${encodeURIComponent(id)}/steps`, { body: step });
  }

  async updateInvestigation(id, patch) {
    return this.request('PATCH', `/investigations/${encodeURIComponent(id)}`, { body: patch });
  }
}

// Re-export a default instance wired to read from the renderer's localStorage
// JWT. The default token provider returns null in non-browser/Node contexts, so
// the app must call setTokenProvider() once the renderer has supplied a token.
const defaultTokenProvider = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('tq_cloud_token');
    }
  } catch {
    /* no-op */
  }
  return null;
};

export const cloudClient = new CloudClient({ getToken: defaultTokenProvider });
