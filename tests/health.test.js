import { describe, it, expect, vi, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/server.js';
import { closePool } from '../database/mysql.js';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => { req.userId = 'user-1'; next(); },
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  SESSION_COOKIE: 'tq_session',
}));

vi.mock('../database/mongodb.js', () => ({
  connectDb: vi.fn().mockResolvedValue({}),
  closeDb: vi.fn().mockResolvedValue(),
  testDbConnection: vi.fn().mockResolvedValue(true),
  mongoose: {},
}));

vi.mock('../database/investigation-store.js', () => ({
  createInvestigation: vi.fn().mockResolvedValue({ id: 'test-id', startedAt: new Date() }),
  addStep: vi.fn().mockResolvedValue(),
  finalizeInvestigation: vi.fn().mockResolvedValue(),
  getInvestigation: vi.fn().mockResolvedValue(null),
  listInvestigations: vi.fn().mockResolvedValue([]),
}));

vi.mock('../database/connection-store.js', () => ({
  testConnection: vi.fn().mockResolvedValue({ success: true }),
  getConnectionRow: vi.fn().mockResolvedValue({
    id: 'conn-1',
    name: 'Test Connection',
    dbHost: '127.0.0.1',
    dbPort: 3306,
    dbUser: 'test',
    encryptedPassword: 'enc',
  }),
  touchConnection: vi.fn().mockResolvedValue(),
  listConnectionRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../agent/agent.js', () => ({
  runInvestigation: vi.fn().mockResolvedValue({
    status: 'completed',
    finalAnswer: 'test answer',
    steps: 2,
    sqlQueries: 1,
  }),
}));

describe('Health Endpoint', () => {
  it('should respond to health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.version).toBeDefined();
  });

  it('should reject missing question on investigate', async () => {
    const res = await request(app)
      .post('/api/investigate')
      .send({});
    expect(res.status).toBe(400);
  });

  it('should reject empty string question on investigate', async () => {
    const res = await request(app)
      .post('/api/investigate')
      .send({ question: '   ' });
    expect(res.status).toBe(400);
  });

  it('should reject non-string question on investigate', async () => {
    const res = await request(app)
      .post('/api/investigate')
      .send({ question: 123 });
    expect(res.status).toBe(400);
  });

  it('should reject question exceeding MAX_QUESTION_LENGTH', async () => {
    const longQuestion = 'a'.repeat(5001);
    const res = await request(app)
      .post('/api/investigate')
      .send({ question: longQuestion });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('maximum length');
    expect(res.body.maxLength).toBe(5000);
    expect(res.body.actualLength).toBe(5001);
  });

  it('should accept question at MAX_QUESTION_LENGTH and return 202 queued', async () => {
    const maxQuestion = 'a'.repeat(5000);
    const res = await request(app)
      .post('/api/investigate')
      .send({ question: maxQuestion, connectionId: 'conn-1', database: 'traceiq' });
    expect(res.status).toBe(202);
    expect(res.body.investigationId).toBeTruthy();
    expect(res.body.status).toBe('queued');
  });

  it('should list investigations', async () => {
    const res = await request(app).get('/api/investigations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  afterAll(async () => {
    await closePool();
  });
});
