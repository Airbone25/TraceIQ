import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudClient, CloudApiError, cloudClient } from '../services/cloud-client.js';

function makeFetchMock() {
  const calls = [];
  const fn = vi.fn();
  fn.__calls = calls;
  return fn;
}

// Build a fetch mock returning the given response. record captured requests.
function stubFetch({ status = 200, body = {} }) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: () => 'application/json',
      },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  fetchImpl.__calls = calls;
  return { fetchImpl, calls };
}

describe('CloudClient', () => {
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = makeFetchMock();
  });

  describe('request plumbing', () => {
    it('prepends /api and the base URL, omitting a trailing slash', async () => {
      const { fetchImpl, calls } = stubFetch({ body: { ok: true } });
      const client = new CloudClient({ baseUrl: 'https://cloud.example.com/', fetchImpl });
      await client.me();
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://cloud.example.com/api/auth/me');
      expect(calls[0].options.method).toBe('GET');
    });

    it('injects Authorization: Bearer from the token provider', async () => {
      const { fetchImpl, calls } = stubFetch({ body: { id: 1 } });
      const client = new CloudClient({
        baseUrl: 'http://x',
        fetchImpl,
        getToken: () => 'jwt-token-abc',
      });
      await client.me();
      expect(calls[0].options.headers.Authorization).toBe('Bearer jwt-token-abc');
    });

    it('serializes JSON bodies and content-type header', async () => {
      const { fetchImpl, calls } = stubFetch({ status: 201, body: { id: 'c1' } });
      const client = new CloudClient({ baseUrl: 'http://x', fetchImpl, getToken: () => 't' });
      await client.createConnection({ name: 'shop', host: 'db.local', port: 3306, user: 'root', password: 'pw' });
      expect(calls[0].options.headers['Content-Type']).toBe('application/json');
      const sent = JSON.parse(calls[0].options.body);
      expect(sent.password).toBe('pw');
      expect(sent.name).toBe('shop');
    });

    it('throws a CloudApiError on non-2xx with the server error message', async () => {
      const { fetchImpl } = stubFetch({ status: 401, body: { error: 'Authentication required' } });
      const client = new CloudClient({ baseUrl: 'http://x', fetchImpl, getToken: () => null });
      await expect(client.me()).rejects.toMatchObject({
        message: 'Authentication required',
        status: 401,
      });
    });

    it('wraps network failures as CloudApiError', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      const client = new CloudClient({ baseUrl: 'http://x', fetchImpl });
      await expect(client.me()).rejects.toBeInstanceOf(CloudApiError);
    });
  });

  describe('endpoint mapping', () => {
    it('maps login to POST /auth/login without auth', async () => {
      const { fetchImpl, calls } = stubFetch({ body: { token: 'tok', user: {} } });
      const client = new CloudClient({ baseUrl: 'http://x', fetchImpl });
      await client.login({ email: 'a@b.c', password: 'pw' });
      expect(calls[0].url).toBe('http://x/api/auth/login');
      expect(calls[0].options.headers.Authorization).toBeUndefined();
    });

    it('maps thread context with turns query param', async () => {
      const { fetchImpl, calls } = stubFetch({ body: {} });
      const client = new CloudClient({ baseUrl: 'http://x', fetchImpl, getToken: () => 't' });
      await client.getThreadContext('th1', 5);
      expect(calls[0].url).toBe('http://x/api/threads/th1/context?turns=5');
    });

    it('URL-encodes path segments', async () => {
      const { fetchImpl, calls } = stubFetch({ status: 204, body: {} });
      const client = new CloudClient({ baseUrl: 'http://x', fetchImpl, getToken: () => 't' });
      await client.deleteConnection('a b/c');
      expect(calls[0].url).toBe('http://x/api/connections/a%20b%2Fc');
      expect(calls[0].options.method).toBe('DELETE');
    });
  });

  describe('default instance', () => {
    it('uses a token provider that reads tq_cloud_token from window.localStorage', () => {
      expect(cloudClient.getToken).toBeTypeOf('function');
      const original = globalThis.window;
      globalThis.window = { localStorage: { getItem: vi.fn(() => 'ls-token') } };
      try {
        expect(cloudClient.getToken()).toBe('ls-token');
      } finally {
        if (original === undefined) delete globalThis.window;
        else globalThis.window = original;
      }
    });
  });
});
