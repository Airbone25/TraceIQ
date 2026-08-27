import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  createConnection: vi.fn().mockResolvedValue({ id: 'conn-new', name: 'Prod', host: 'db.internal', port: 3306, user: 'reader' }),
  listConnections: vi.fn().mockResolvedValue([]),
  getConnectionRow: vi.fn(),
  deleteConnection: vi.fn().mockResolvedValue(true),
  verifyConnection: vi.fn().mockResolvedValue(true),
  listDatabasesOnConnection: vi.fn().mockResolvedValue(['sales_db', 'financial_db']),
  touchConnection: vi.fn().mockResolvedValue(undefined),
  checkConnectionHealth: vi.fn().mockResolvedValue({ id: 'c1', healthy: true, latencyMs: 12, error: null }),
  listConnectionSchema: vi.fn().mockResolvedValue({ database: null, tables: [{ schema: 'sales_db', name: 'orders', columns: [{ name: 'id', type: 'int', nullable: false, key: 'PRI' }] }] }),
  provisionSampleDataset: vi.fn().mockResolvedValue({ ok: true, database: 'traceiq_sample' }),
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => { req.userId = 'user-1'; next(); },
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  SESSION_COOKIE: 'tq_session',
}));

vi.mock('../database/connection-store.js', () => ({
  createConnection: mocks.createConnection,
  listConnections: mocks.listConnections,
  getConnectionRow: mocks.getConnectionRow,
  deleteConnection: mocks.deleteConnection,
  verifyConnection: mocks.verifyConnection,
  listDatabasesOnConnection: mocks.listDatabasesOnConnection,
  touchConnection: mocks.touchConnection,
  checkConnectionHealth: mocks.checkConnectionHealth,
  listConnectionSchema: mocks.listConnectionSchema,
  provisionSampleDataset: mocks.provisionSampleDataset,
  SYSTEM_DATABASES: new Set(['information_schema', 'mysql', 'performance_schema', 'sys']),
}));

vi.mock('../database/thread-store.js', () => ({
  generateThreadId: vi.fn(() => 'generated-thread-id'),
  createThread: vi.fn().mockResolvedValue({ id: 'thread-x', title: 'Q?', connectionId: 'conn-1', database: 'sales_db' }),
  addMessage: vi.fn(),
  getThread: vi.fn().mockResolvedValue(null),
  listThreads: vi.fn().mockResolvedValue([]),
  getMessages: vi.fn().mockResolvedValue([]),
  getThreadRuns: vi.fn().mockResolvedValue([]),
  getLatestRunSteps: vi.fn().mockResolvedValue([]),
  hasActiveRun: vi.fn().mockResolvedValue(false),
  getThreadContext: vi.fn().mockResolvedValue([]),
  deleteThread: vi.fn().mockResolvedValue(true),
}));

vi.mock('../database/investigation-store.js', () => ({
  createInvestigation: vi.fn().mockResolvedValue({ id: 'inv-x', startedAt: new Date() }),
  addStep: vi.fn(),
  finalizeInvestigation: vi.fn(),
  getInvestigation: vi.fn().mockResolvedValue(null),
  listInvestigations: vi.fn().mockResolvedValue([]),
  failOrphanedInvestigations: vi.fn().mockResolvedValue(0),
}));

vi.mock('../services/job-runner.js', () => ({
  startJob: vi.fn(),
}));

import app from '../src/server.js';

describe('Connections API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyConnection.mockResolvedValue(true);
    mocks.deleteConnection.mockResolvedValue(true);
    mocks.listDatabasesOnConnection.mockResolvedValue(['sales_db', 'financial_db']);
    mocks.getConnectionRow.mockResolvedValue({ id: 'conn-1', name: 'Prod' });
    mocks.checkConnectionHealth.mockResolvedValue({ id: 'c1', healthy: true, latencyMs: 12, error: null });
    mocks.listConnectionSchema.mockResolvedValue({ database: null, tables: [{ schema: 'sales_db', name: 'orders', columns: [{ name: 'id', type: 'int', nullable: false, key: 'PRI' }] }] });
    mocks.provisionSampleDataset.mockResolvedValue({ ok: true, database: 'traceiq_sample' });
  });

  describe('POST /api/connections', () => {
    const validBody = { name: 'Prod', host: 'db.internal', port: 3306, user: 'reader', password: 'pw' };

    it('should verify and store a connection (201)', async () => {
      const res = await request(app).post('/api/connections').send(validBody);

      expect(res.status).toBe(201);
      expect(mocks.verifyConnection).toHaveBeenCalledWith({
        host: 'db.internal', port: 3306, user: 'reader', password: 'pw',
      });
      expect(res.body.id).toBe('conn-new');
    });

    it('should return 422 when the MySQL server is unreachable', async () => {
      mocks.verifyConnection.mockRejectedValue(new Error('ECONNREFUSED'));
      const res = await request(app).post('/api/connections').send(validBody);

      expect(res.status).toBe(422);
      expect(res.body.error).toContain('Could not connect');
      expect(mocks.createConnection).not.toHaveBeenCalled();
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app).post('/api/connections').send({ name: 'X' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/connections', () => {
    it('should list connections without secrets', async () => {
      mocks.listConnections.mockResolvedValue([{ id: 'c1', name: 'Prod', host: 'h', port: 3306, user: 'u' }]);
      const res = await request(app).get('/api/connections');

      expect(res.status).toBe(200);
      expect(mocks.listConnections).toHaveBeenCalledWith('user-1');
      expect(res.body[0]).not.toHaveProperty('password_enc');
    });
  });

  describe('DELETE /api/connections/:id', () => {
    it('should return 204 on success and 404 when missing', async () => {
      const ok = await request(app).delete('/api/connections/conn-9');
      expect(ok.status).toBe(204);
      expect(mocks.deleteConnection).toHaveBeenCalledWith('conn-9', 'user-1');

      mocks.deleteConnection.mockResolvedValue(false);
      const missing = await request(app).delete('/api/connections/nope');
      expect(missing.status).toBe(404);
    });
  });

  describe('GET /api/connections/:id/databases', () => {
    it('should list user databases for a connection', async () => {
      const res = await request(app).get('/api/connections/conn-1/databases');

      expect(res.status).toBe(200);
      expect(res.body.databases).toEqual(['sales_db', 'financial_db']);
    });

    it('should return 404 for unknown connections', async () => {
      mocks.getConnectionRow.mockResolvedValue(null);
      const res = await request(app).get('/api/connections/nope/databases');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/connections/health', () => {
    it('should return health status for each saved connection', async () => {
      mocks.listConnections.mockResolvedValue([{ id: 'c1', name: 'Prod' }]);
      mocks.checkConnectionHealth.mockResolvedValue({ id: 'c1', healthy: true, latencyMs: 12, error: null });
      const res = await request(app).get('/api/connections/health');

      expect(res.status).toBe(200);
      expect(res.body.connections[0]).toMatchObject({ id: 'c1', name: 'Prod', healthy: true });
    });
  });

  describe('GET /api/connections/:id/schema', () => {
    it('should return tables + columns for a connection', async () => {
      const res = await request(app).get('/api/connections/conn-1/schema');

      expect(res.status).toBe(200);
      expect(mocks.listConnectionSchema).toHaveBeenCalledWith('conn-1', null, 'user-1');
      expect(res.body.tables[0].name).toBe('orders');
      expect(res.body.tables[0].columns[0].name).toBe('id');
    });

    it('should pass a database filter when provided', async () => {
      await request(app).get('/api/connections/conn-1/schema?database=sales_db');
      expect(mocks.listConnectionSchema).toHaveBeenCalledWith('conn-1', 'sales_db', 'user-1');
    });

    it('should return 404 for unknown connections', async () => {
      mocks.getConnectionRow.mockResolvedValue(null);
      const res = await request(app).get('/api/connections/nope/schema');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/connections/:id/sample-dataset', () => {
    it('should provision a sample dataset and return its database name', async () => {
      const res = await request(app).post('/api/connections/conn-1/sample-dataset');

      expect(res.status).toBe(201);
      expect(mocks.provisionSampleDataset).toHaveBeenCalledWith('conn-1', 'user-1');
      expect(res.body.database).toBe('traceiq_sample');
    });

    it('should return 404 for unknown connections', async () => {
      mocks.getConnectionRow.mockResolvedValue(null);
      const res = await request(app).post('/api/connections/nope/sample-dataset');
      expect(res.status).toBe(404);
    });
  });

  describe('Thread binding via POST /api/threads', () => {
    it('should accept connectionId + database and create a bound thread', async () => {
      const res = await request(app).post('/api/threads').send({
        question: 'Why did revenue drop?',
        connectionId: 'conn-1',
        database: 'sales_db',
      });

      expect(res.status).toBe(202);
      expect(res.body.database).toBe('sales_db');
    });

    it('should reject invalid database names with 400', async () => {
      const res = await request(app).post('/api/threads').send({
        question: 'Why did revenue drop?',
        connectionId: 'conn-1',
        database: 'not; a db',
      });
      expect(res.status).toBe(400);
    });

    it('should return 404 when the connection does not exist', async () => {
      mocks.getConnectionRow.mockResolvedValue(null);
      const res = await request(app).post('/api/threads').send({
        question: 'Why did revenue drop?',
        connectionId: 'ghost',
        database: 'sales_db',
      });
      expect(res.status).toBe(404);
    });
  });
});
