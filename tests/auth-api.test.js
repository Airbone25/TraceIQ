import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  createUser: vi.fn().mockResolvedValue({ id: 'user-new', email: 'a@b.com' }),
  getUserByEmail: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn().mockResolvedValue({ id: 'user-1', email: 'a@b.com' }),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock('../database/user-store.js', () => ({
  generateUserId: vi.fn(() => 'generated-user-id'),
  createUser: mocks.createUser,
  getUserByEmail: mocks.getUserByEmail,
  getUserById: mocks.getUserById,
  verifyPassword: mocks.verifyPassword,
}));

import app from '../src/server.js';

function extractSessionCookie(res) {
  const raw = res.headers['set-cookie']?.[0] || '';
  return raw.split(';')[0];
}

describe('Auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUser.mockResolvedValue({ id: 'user-new', email: 'a@b.com' });
    mocks.getUserByEmail.mockResolvedValue({ id: 'user-1', email: 'a@b.com', password_hash: '$2a$10$hash' });
    mocks.getUserById.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mocks.verifyPassword.mockResolvedValue(true);
  });

  describe('POST /api/auth/register', () => {
    it('should create an account and set an httpOnly session cookie', async () => {
      mocks.getUserByEmail.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'A@B.com', password: 'hunter2222' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'user-new', email: 'a@b.com' });
      expect(mocks.createUser).toHaveBeenCalledWith({ email: 'a@b.com', password: 'hunter2222' });

      const cookie = res.headers['set-cookie'][0];
      expect(cookie).toContain('tq_session=');
      expect(cookie.toLowerCase()).toContain('httponly');
      expect(cookie.toLowerCase()).toContain('samesite=lax');
    });

    it('should reject invalid payloads with 400', async () => {
      const badEmail = await request(app).post('/api/auth/register').send({ email: 'nope', password: 'hunter2222' });
      const shortPw = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'short' });
      expect(badEmail.status).toBe(400);
      expect(shortPw.status).toBe(400);
      expect(mocks.createUser).not.toHaveBeenCalled();
    });

    it('should return 409 when the email is already registered', async () => {
      mocks.getUserByEmail.mockResolvedValueOnce({ id: 'existing', email: 'a@b.com' });
      const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'hunter2222' });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should set a session cookie on valid credentials', async () => {
      mocks.getUserByEmail.mockResolvedValueOnce({
        id: 'u1', email: 'a@b.com', password_hash: '$2a$10$hash',
      });
      const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pw123456' });

      expect(res.status).toBe(200);
      expect(mocks.verifyPassword).toHaveBeenCalledWith('pw123456', '$2a$10$hash');
      expect(res.headers['set-cookie'][0]).toContain('tq_session=');
    });

    it('should return 401 for a wrong password without revealing which part failed', async () => {
      mocks.getUserByEmail.mockResolvedValueOnce({
        id: 'u1', email: 'a@b.com', password_hash: '$2a$10$hash',
      });
      mocks.verifyPassword.mockResolvedValueOnce(false);
      const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'wrong-pass' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('should return 401 for an unknown email', async () => {
      mocks.getUserByEmail.mockResolvedValueOnce(null);
      const res = await request(app).post('/api/auth/login').send({ email: 'ghost@x.com', password: 'whatever1' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should resolve the signed-in user from the session cookie', async () => {
      const login = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pw123456' });
      const me = await request(app).get('/api/auth/me').set('Cookie', extractSessionCookie(login));

      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ id: 'user-1', email: 'a@b.com', groqConfigured: false });
    });

    it('should return 401 without a cookie', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return 401 for a tampered cookie', async () => {
      const res = await request(app).get('/api/auth/me').set('Cookie', 'tq_session=garbage.token.here');
      expect(res.status).toBe(401);
    });
  });

  describe('Protected routes', () => {
    it('should reject API access without a session with 401', async () => {
      const threads = await request(app).get('/api/threads');
      const connections = await request(app).get('/api/connections');
      expect(threads.status).toBe(401);
      expect(connections.status).toBe(401);
    });

    it('should allow access with a valid session', async () => {
      const login = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pw123456' });
      const threads = await request(app).get('/api/threads').set('Cookie', extractSessionCookie(login));
      expect(threads.status).not.toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear the session cookie', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      const cookie = res.headers['set-cookie'][0];
      expect(cookie).toContain('tq_session=;');
    });
  });

  describe('GET /api/health stays public', () => {
    it('should respond without a session', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).not.toBe(401);
    });
  });
});
