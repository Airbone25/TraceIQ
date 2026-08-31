import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import http from 'http';
import { notify } from '../services/notifier.js';

const mocks = vi.hoisted(() => ({
  createThread: vi.fn().mockResolvedValue({ id: 'thread-new', title: 'Q?' }),
  addMessage: vi.fn().mockResolvedValue(undefined),
  getThread: vi.fn(),
  listThreads: vi.fn().mockResolvedValue([]),
  getMessages: vi.fn().mockResolvedValue([]),
  getThreadRuns: vi.fn().mockResolvedValue([]),
  getLatestRunSteps: vi.fn().mockResolvedValue([]),
  hasActiveRun: vi.fn().mockResolvedValue(false),
  getThreadContext: vi.fn().mockResolvedValue([]),
  deleteThread: vi.fn().mockResolvedValue(true),
  createInvestigation: vi.fn().mockResolvedValue({ id: 'inv-new', startedAt: new Date() }),
  getInvestigation: vi.fn().mockResolvedValue(null),
  listInvestigations: vi.fn().mockResolvedValue([]),
  failOrphanedInvestigations: vi.fn().mockResolvedValue(0),
  startJob: vi.fn(),
  cancelJob: vi.fn().mockReturnValue(true),
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => { req.userId = 'user-1'; next(); },
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  SESSION_COOKIE: 'tq_session',
}));

vi.mock('../database/thread-store.js', () => ({
  generateThreadId: vi.fn(() => 'generated-thread-id'),
  createThread: mocks.createThread,
  addMessage: mocks.addMessage,
  getThread: mocks.getThread,
  listThreads: mocks.listThreads,
  getMessages: mocks.getMessages,
  getThreadRuns: mocks.getThreadRuns,
  getLatestRunSteps: mocks.getLatestRunSteps,
  hasActiveRun: mocks.hasActiveRun,
  getThreadContext: mocks.getThreadContext,
  deleteThread: mocks.deleteThread,
}));

vi.mock('../database/investigation-store.js', () => ({
  createInvestigation: mocks.createInvestigation,
  addStep: vi.fn(),
  finalizeInvestigation: vi.fn(),
  getInvestigation: mocks.getInvestigation,
  listInvestigations: mocks.listInvestigations,
  failOrphanedInvestigations: mocks.failOrphanedInvestigations,
}));

vi.mock('../services/job-runner.js', () => ({
  startJob: mocks.startJob,
  cancelJob: mocks.cancelJob,
}));

import app from '../src/server.js';

describe('Threads API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createThread.mockResolvedValue({ id: 'thread-new', title: 'Q?' });
    mocks.createInvestigation.mockResolvedValue({ id: 'inv-new', startedAt: new Date() });
    mocks.hasActiveRun.mockResolvedValue(false);
    mocks.getThreadContext.mockResolvedValue([]);
    mocks.listThreads.mockResolvedValue([]);
    mocks.getMessages.mockResolvedValue([]);
    mocks.getThreadRuns.mockResolvedValue([]);
    mocks.getLatestRunSteps.mockResolvedValue([]);
  });

  describe('POST /api/threads', () => {
    it('should create thread, persist user message, queue run and return 202', async () => {
      const res = await request(app).post('/api/threads').send({ question: 'Why did orders drop?' });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        threadId: 'thread-new',
        investigationId: 'inv-new',
        status: 'queued',
        connectionId: null,
        database: null,
      });
      expect(mocks.createThread).toHaveBeenCalledWith('Why did orders drop?', { connectionId: null, database: null, userId: 'user-1' });
      expect(mocks.addMessage).toHaveBeenCalledWith('thread-new', 'user', 'Why did orders drop?');
      expect(mocks.createInvestigation).toHaveBeenCalledWith('Why did orders drop?', 'thread-new', 'user-1');
      expect(mocks.startJob).toHaveBeenCalledWith({
        investigationId: 'inv-new',
        question: 'Why did orders drop?',
        threadId: 'thread-new',
        userId: 'user-1',
      });
    });

    it('should reject missing question with 400', async () => {
      const res = await request(app).post('/api/threads').send({});
      expect(res.status).toBe(400);
      expect(mocks.createThread).not.toHaveBeenCalled();
    });

    it('should reject empty question with 400', async () => {
      const res = await request(app).post('/api/threads').send({ question: '   ' });
      expect(res.status).toBe(400);
    });

    it('should reject over-length question with 400', async () => {
      const res = await request(app).post('/api/threads').send({ question: 'a'.repeat(5001) });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('maximum length');
    });
  });

  describe('POST /api/threads/:id/messages', () => {
    it('should queue follow-up with prior context and return 202', async () => {
      const context = [{ question: 'Earlier?', answer: 'Earlier finding.' }];
      mocks.getThread.mockResolvedValue({ id: 't1', title: 'A' });
      mocks.getThreadContext.mockResolvedValue(context);

      const res = await request(app).post('/api/threads/t1/messages').send({ question: 'And now?' });

      expect(res.status).toBe(202);
      expect(res.body.threadId).toBe('t1');
      expect(mocks.hasActiveRun).toHaveBeenCalledWith('t1');
      expect(mocks.addMessage).toHaveBeenCalledWith('t1', 'user', 'And now?');
      expect(mocks.startJob).toHaveBeenCalledWith(expect.objectContaining({
        threadId: 't1',
        question: 'And now?',
        threadContext: context,
      }));
    });

    it('should return 404 for unknown thread', async () => {
      mocks.getThread.mockResolvedValue(null);
      const res = await request(app).post('/api/threads/missing/messages').send({ question: 'Hi' });
      expect(res.status).toBe(404);
    });

    it('should return 409 when a run is still active in the thread', async () => {
      mocks.getThread.mockResolvedValue({ id: 't1', title: 'A' });
      mocks.hasActiveRun.mockResolvedValue(true);

      const res = await request(app).post('/api/threads/t1/messages').send({ question: 'Follow-up?' });

      expect(res.status).toBe(409);
      expect(mocks.startJob).not.toHaveBeenCalled();
    });

    it('should reject invalid question with 400 before touching stores', async () => {
      const res = await request(app).post('/api/threads/t1/messages').send({});
      expect(res.status).toBe(400);
      expect(mocks.getThread).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/threads', () => {
    it('should list threads', async () => {
      mocks.listThreads.mockResolvedValue([{ id: 't1', title: 'A', latest_status: 'completed' }]);
      const res = await request(app).get('/api/threads');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].latest_status).toBe('completed');
    });
  });

  describe('GET /api/threads/:id', () => {
    it('should return thread detail with messages, runs and steps', async () => {
      mocks.getThread.mockResolvedValue({ id: 't1', title: 'A' });
      mocks.getMessages.mockResolvedValue([{ id: 1, role: 'user', content: 'Hi' }]);
      mocks.getThreadRuns.mockResolvedValue([{ id: 'inv-1', status: 'completed' }]);
      mocks.getLatestRunSteps.mockResolvedValue([{ step_number: 1, tool_name: 'get_schema' }]);

      const res = await request(app).get('/api/threads/t1');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('t1');
      expect(res.body.messages).toHaveLength(1);
      expect(res.body.runs).toHaveLength(1);
      expect(res.body.latestRunSteps).toHaveLength(1);
    });

    it('should return 404 for unknown thread', async () => {
      mocks.getThread.mockResolvedValue(null);
      const res = await request(app).get('/api/threads/missing');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/threads/:id', () => {
    it('should delete the thread and return 204', async () => {
      mocks.deleteThread.mockResolvedValue(true);
      const res = await request(app).delete('/api/threads/t1');
      expect(res.status).toBe(204);
      expect(mocks.deleteThread).toHaveBeenCalledWith('t1', 'user-1');
    });

    it('should return 404 for unknown thread', async () => {
      mocks.deleteThread.mockResolvedValue(false);
      const res = await request(app).delete('/api/threads/nope');
      expect(res.status).toBe(404);
    });

    it('should cancel the active run before deleting the thread', async () => {
      mocks.getThreadRuns.mockResolvedValue([{ id: 'inv-active', status: 'running' }]);
      mocks.deleteThread.mockResolvedValue(true);
      const res = await request(app).delete('/api/threads/t1');
      expect(res.status).toBe(204);
      expect(mocks.cancelJob).toHaveBeenCalledWith('inv-active');
      expect(mocks.deleteThread).toHaveBeenCalledWith('t1', 'user-1');
    });

    it('should not attempt to cancel non-running runs before deleting', async () => {
      mocks.getThreadRuns.mockResolvedValue([{ id: 'inv-done', status: 'completed' }]);
      mocks.deleteThread.mockResolvedValue(true);
      const res = await request(app).delete('/api/threads/t1');
      expect(res.status).toBe(204);
      expect(mocks.cancelJob).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/investigations/:id/cancel', () => {
    it('should return 404 when the investigation is not found or not owned', async () => {
      mocks.getInvestigation.mockResolvedValue(null);
      const res = await request(app).post('/api/investigations/ghost/cancel');
      expect(res.status).toBe(404);
      expect(mocks.cancelJob).not.toHaveBeenCalled();
    });

    it('should request cancellation and return 202 when the job is active', async () => {
      mocks.getInvestigation.mockResolvedValue({ id: 'inv-1', status: 'running' });
      mocks.cancelJob.mockReturnValue(true);
      const res = await request(app).post('/api/investigations/inv-1/cancel');
      expect(res.status).toBe(202);
      expect(mocks.cancelJob).toHaveBeenCalledWith('inv-1');
      expect(res.body).toMatchObject({ id: 'inv-1', status: 'cancelling', ok: true });
    });

    it('should be idempotent (200) when the job is no longer running', async () => {
      mocks.getInvestigation.mockResolvedValue({ id: 'inv-2', status: 'cancelled' });
      mocks.cancelJob.mockReturnValue(false);
      const res = await request(app).post('/api/investigations/inv-2/cancel');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'inv-2', status: 'cancelled', ok: true });
    });
  });

  describe('GET /api/threads/:id/stream (SSE)', () => {
    it('should open an event-stream, send a snapshot, then stream an update on notify', async () => {
      mocks.getThread.mockResolvedValue({ id: 't-sse', title: 'A' });
      mocks.getMessages.mockResolvedValue([{ role: 'user', content: 'Hi' }]);
      mocks.getThreadRuns.mockResolvedValue([{ id: 'inv-1', status: 'running' }]);
      mocks.getLatestRunSteps.mockResolvedValue([]);

      const server = app.listen(0);
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}/api/threads/t-sse/stream`;

      const received = [];
      await new Promise((resolve, reject) => {
        const req = http.get(url, { headers: { Authorization: 'Bearer x' } }, (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toContain('text/event-stream');
          res.setEncoding('utf8');
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk;
            const parts = buf.split('\n\n');
            buf = parts.pop();
            for (const p of parts) {
              if (p.trim()) received.push(p);
            }
            if (received.length >= 1) {
              notify('t-sse', { type: 'update' });
            }
            if (received.length >= 2) {
              res.destroy();
              resolve();
            }
          });
          res.on('error', reject);
        });
        req.on('error', reject);
      });
      server.close();

      const joined = received.join('\n\n');
      expect(joined).toContain('event: snapshot');
      expect(joined).toContain('event: update');
      expect(joined).toContain('"id":"t-sse"');
    });
  });
});
