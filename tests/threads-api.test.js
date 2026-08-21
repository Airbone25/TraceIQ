import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

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
      expect(mocks.createThread).toHaveBeenCalledWith('Why did orders drop?', { connectionId: null, database: null });
      expect(mocks.addMessage).toHaveBeenCalledWith('thread-new', 'user', 'Why did orders drop?');
      expect(mocks.createInvestigation).toHaveBeenCalledWith('Why did orders drop?', 'thread-new');
      expect(mocks.startJob).toHaveBeenCalledWith({
        investigationId: 'inv-new',
        question: 'Why did orders drop?',
        threadId: 'thread-new',
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
      expect(mocks.deleteThread).toHaveBeenCalledWith('t1');
    });

    it('should return 404 for unknown thread', async () => {
      mocks.deleteThread.mockResolvedValue(false);
      const res = await request(app).delete('/api/threads/nope');
      expect(res.status).toBe(404);
    });
  });
});
