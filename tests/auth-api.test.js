import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('../database/user-store.js', () => ({
  generateUserId: vi.fn(() => 'generated-user-id'),
  createUser: mocks.createUser,
  getUserByEmail: mocks.getUserByEmail,
  getUserById: mocks.getUserById,
  verifyPassword: mocks.verifyPassword,
}));

vi.mock('../database/thread-store.js', () => ({
  listThreads: vi.fn().mockResolvedValue([]),
}));

vi.mock('../database/mongodb.js', () => ({
  connectDb: vi.fn().mockResolvedValue({}),
  closeDb: vi.fn().mockResolvedValue(),
  testDbConnection: vi.fn().mockResolvedValue(true),
  mongoose: {},
}));

import app from '../src/server.js';

function bearer(res) {
  return `Bearer ${res.body.token}`;
}

describe('Auth API (local JWT)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUser.mockResolvedValue({ id: 'user-new', email: 'a@b.com' });
    mocks.getUserByEmail.mockResolvedValue({ id: 'u1', email: 'a@b.com', password_hash: '$2a$10$hash' });
    mocks.getUserById.mockResolvedValue({ id: 'u1', email: 'a@b.com', groq_configured: false });
    mocks.verifyPassword.mockResolvedValue(true);
  });

  describe('POST /api/auth/register', () => {
    it('should create an account and return a JWT token', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'A@B.com', password: 'hunter2222' });

      expect(res.status).toBe(201);
      expect(mocks.createUser).toHaveBeenCalledWith({ email: 'A@B.com', password: 'hunter2222' });
      expect(res.body.token).toBeTruthy();
      expect(res.body).toMatchObject({ id: 'user-new', email: 'a@b.com', groqConfigured: false });
    });

    it('should reject invalid payloads with 400', async () => {
      const badEmail = await request(app).post('/api/auth/register').send({ email: 'nope', password: 'hunter2222' });
      const shortPw = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'short' });
      expect(badEmail.status).toBe(400);
      expect(shortPw.status).toBe(400);
      expect(mocks.createUser).not.toHaveBeenCalled();
    });

    it('should return 409 when the email is already registered', async () => {
      mocks.createUser.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }));
      const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'hunter2222' });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return a valid JWT on correct credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pw123456' });

      expect(res.status).toBe(200);
      expect(mocks.verifyPassword).toHaveBeenCalledWith('pw123456', '$2a$10$hash');
      expect(res.body.token).toBeTruthy();
      expect(res.body).toMatchObject({ id: 'u1', email: 'a@b.com' });
    });

    it('should return 401 for a wrong password without revealing which part failed', async () => {
      mocks.verifyPassword.mockResolvedValueOnce(false);
      const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'wrong-pass' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
      expect(res.body.token).toBeUndefined();
    });

    it('should return 401 for an unknown email', async () => {
      mocks.getUserByEmail.mockResolvedValueOnce(null);
      const res = await request(app).post('/api/auth/login').send({ email: 'ghost@x.com', password: 'whatever1' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should resolve the signed-in user from a Bearer token', async () => {
      const login = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pw123456' });
      const me = await request(app).get('/api/auth/me').set('Authorization', bearer(login));

      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ id: 'u1', email: 'a@b.com', groqConfigured: false });
    });

    it('should return 401 without a token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return 401 for a tampered token', async () => {
      const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage.token.here');
      expect(res.status).toBe(401);
    });
  });

  describe('Protected routes', () => {
    it('should reject API access without a token with 401', async () => {
      const threads = await request(app).get('/api/threads');
      const connections = await request(app).get('/api/connections');
      expect(threads.status).toBe(401);
      expect(connections.status).toBe(401);
    });

    it('should allow access with a valid Bearer token', async () => {
      const login = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pw123456' });
      const threads = await request(app).get('/api/threads').set('Authorization', bearer(login));
      expect(threads.status).not.toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should return ok and not require a token', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('GET /api/health stays public', () => {
    it('should respond without a token', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).not.toBe(401);
    });
  });
});
