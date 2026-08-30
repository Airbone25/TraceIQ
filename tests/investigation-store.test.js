import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => {
  function invDoc(over = {}) {
    return {
      _id: { toString: () => over.id || 'inv-1' },
      question: over.question ?? 'Q',
      status: over.status ?? 'running',
      finalAnswer: over.finalAnswer ?? null,
      error: over.error ?? null,
      threadId: over.threadId ? { toString: () => over.threadId } : null,
      userId: over.userId || 'user-1',
      steps: over.steps ?? 0,
      sqlQueries: over.sqlQueries ?? 0,
      created_at: over.started_at ?? new Date('2024-01-01'),
      updated_at: over.completed_at ?? new Date('2024-01-02'),
    };
  }
  function stepDoc(over = {}) {
    return {
      _id: { toString: () => over.id || 's1' },
      stepNumber: over.step_number ?? 1,
      toolName: over.tool_name ?? 'get_schema',
      toolInput: over.tool_input ?? null,
      toolOutput: over.tool_output ?? null,
      durationMs: over.duration_ms ?? 0,
      created_at: over.created_at ?? new Date('2024-01-01'),
    };
  }
  function queryResult(docs) {
    return { sort: () => docs, limit: () => docs };
  }
  function singleQuery(doc) {
    const q = {
      sort: () => q,
      then: (resolve) => resolve(doc),
    };
    return q;
  }
  function findByIdQuery(doc) {
    const q = {
      select: () => q,
      then: (resolve) => resolve(doc),
    };
    return q;
  }

  const Investigation = {
    create: vi.fn(async (d) => invDoc({ id: 'new', ...d, threadId: d.threadId ? String(d.threadId) : null, userId: d.userId || 'user-1' })),
    findById: vi.fn(() => findByIdQuery(null)),
    findOne: vi.fn(() => null),
    find: vi.fn(() => queryResult([])),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
  };
  const Step = {
    create: vi.fn(async (d) => stepDoc({ ...d, id: 's-new' })),
    find: vi.fn(() => queryResult([])),
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
  };
  return { Investigation, Step, invDoc, stepDoc, findByIdQuery, singleQuery, queryResult };
});

vi.mock('../database/collections/index.js', () => ({
  Investigation: fake.Investigation,
  Step: fake.Step,
  User: {},
  GroqKey: {},
  Connection: {},
  Thread: {},
  Message: {},
}));

const { generateId, createInvestigation, addStep, finalizeInvestigation, getInvestigation, listInvestigations } = await import('../database/investigation-store.js');

describe('Investigation Store (Mongoose)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.Investigation.findById.mockReturnValue(fake.findByIdQuery(null));
    fake.Investigation.findOne.mockReturnValue(fake.singleQuery(null));
  });

  describe('generateId', () => {
    it('should generate a valid UUID', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) ids.add(generateId());
      expect(ids.size).toBe(100);
    });
  });

  describe('createInvestigation', () => {
    it('should create an investigation with running status', async () => {
      const { id, startedAt } = await createInvestigation('test question');
      expect(id).toBeTruthy();
      expect(startedAt).toBeInstanceOf(Date);
      expect(fake.Investigation.create).toHaveBeenCalledWith(expect.objectContaining({
        question: 'test question', status: 'running', threadId: null, userId: null,
      }));
    });

    it('should persist a threadId when provided', async () => {
      await createInvestigation('threaded question', 'thread-9', 'user-1');
      expect(fake.Investigation.create).toHaveBeenCalledWith(expect.objectContaining({
        question: 'threaded question', threadId: 'thread-9', userId: 'user-1', status: 'running',
      }));
    });
  });

  describe('addStep', () => {
    it('should insert a step with correct parameters', async () => {
      fake.Investigation.findById.mockReturnValue(fake.findByIdQuery(fake.invDoc({ id: 'inv-123', userId: 'user-1' })));
      await addStep('inv-123', 1, 'execute_sql', { sql: 'SELECT 1' }, { rows: [1] }, 50);
      expect(fake.Investigation.findById).toHaveBeenCalledWith('inv-123');
      expect(fake.Step.create).toHaveBeenCalledWith(expect.objectContaining({
        investigationId: 'inv-123', userId: 'user-1', stepNumber: 1, toolName: 'execute_sql',
        toolInput: { sql: 'SELECT 1' }, toolOutput: { rows: [1] }, durationMs: 50,
      }));
    });

    it('should handle null inputs gracefully', async () => {
      fake.Investigation.findById.mockReturnValue(fake.findByIdQuery(fake.invDoc({ id: 'inv-123', userId: 'user-1' })));
      await addStep('inv-123', 0, 'get_schema', null, null, 0);
      expect(fake.Step.create).toHaveBeenCalledWith(expect.objectContaining({
        stepNumber: 0, toolName: 'get_schema', toolInput: null, toolOutput: null, durationMs: 0,
      }));
    });
  });

  describe('finalizeInvestigation', () => {
    it('should update investigation with completed status', async () => {
      await finalizeInvestigation('inv-123', {
        status: 'completed', answer: 'test answer', error: null, steps: 5, sqlQueries: 3, durationMs: 12345,
      });
      expect(fake.Investigation.updateOne).toHaveBeenCalledWith(
        { _id: 'inv-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'completed', finalAnswer: 'test answer', error: null, steps: 5, sqlQueries: 3, totalDurationMs: 12345,
          }),
        })
      );
    });

    it('should update investigation with failed status and error', async () => {
      await finalizeInvestigation('inv-123', {
        status: 'failed', answer: null, error: 'API key invalid', steps: 2, sqlQueries: 1, durationMs: 5000,
      });
      expect(fake.Investigation.updateOne).toHaveBeenCalledWith(
        { _id: 'inv-123' },
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'failed', finalAnswer: null, error: 'API key invalid' }),
        })
      );
    });
  });

  describe('getInvestigation', () => {
    it('should return null for non-existent investigation', async () => {
      fake.Investigation.findById.mockReturnValue(fake.findByIdQuery(null));
      const result = await getInvestigation('non-existent');
      expect(result).toBeNull();
    });

    it('should return investigation with steps', async () => {
      fake.Investigation.findById.mockReturnValue(fake.findByIdQuery(
        fake.invDoc({ id: 'inv-123', question: 'test', status: 'completed' })
      ));
      fake.Step.find.mockReturnValue(fake.queryResult([
        fake.stepDoc({ id: 's1', step_number: 1, tool_name: 'get_schema' }),
      ]));
      const result = await getInvestigation('inv-123');
      expect(result).toBeTruthy();
      expect(result.id).toBe('inv-123');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]).toMatchObject({ step_number: 1, tool_name: 'get_schema' });
    });

    it('should return empty steps array when no steps exist', async () => {
      fake.Investigation.findById.mockReturnValue(fake.findByIdQuery(
        fake.invDoc({ id: 'inv-456', question: 'test', status: 'running' })
      ));
      fake.Step.find.mockReturnValue(fake.queryResult([]));
      const result = await getInvestigation('inv-456');
      expect(result.steps).toEqual([]);
    });

    it('should scope lookup by owner when a userId is provided', async () => {
      fake.Investigation.findOne.mockReturnValue(fake.singleQuery(fake.invDoc({ id: 'inv-1', question: 'q' })));
      await getInvestigation('inv-1', 'user-1');
      expect(fake.Investigation.findOne).toHaveBeenCalledWith({ _id: 'inv-1', userId: 'user-1' });
    });
  });

  describe('listInvestigations', () => {
    it('should return all investigations for the user', async () => {
      fake.Investigation.find.mockReturnValue(fake.queryResult([
        fake.invDoc({ id: 'inv-1', question: 'q1' }),
        fake.invDoc({ id: 'inv-2', question: 'q2' }),
      ]));
      const result = await listInvestigations('user-1');
      expect(result).toHaveLength(2);
      expect(fake.Investigation.find).toHaveBeenCalledWith({ userId: 'user-1' });
    });

    it('should return empty array when no investigations exist', async () => {
      fake.Investigation.find.mockReturnValue(fake.queryResult([]));
      const result = await listInvestigations('user-1');
      expect(result).toEqual([]);
    });
  });
});
