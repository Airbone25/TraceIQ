import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => {
  function threadDoc(over = {}) {
    return {
      _id: { toString: () => over.id || 't1' },
      title: over.title ?? 'A thread',
      userId: over.userId ?? 'user-1',
      connectionId: over.connectionId ? { toString: () => over.connectionId } : null,
      database: over.database ?? null,
      created_at: over.created_at ?? new Date('2024-01-01'),
      updated_at: over.updated_at ?? new Date('2024-01-02'),
      save: vi.fn(async function () {}),
    };
  }
  function msgDoc(over = {}) {
    return {
      _id: { toString: () => over.id || 'm1' },
      role: over.role ?? 'user',
      content: over.content ?? 'Hi',
      threadId: { toString: () => over.threadId || 't1' },
      userId: over.userId ?? 'user-1',
      created_at: over.created_at ?? new Date('2024-01-01'),
    };
  }
  function invDoc(over = {}) {
    return {
      _id: { toString: () => over.id || 'i1' },
      question: over.question ?? 'Q',
      status: over.status ?? 'completed',
      finalAnswer: over.finalAnswer ?? null,
      threadId: over.threadId ? { toString: () => over.threadId } : null,
      steps: over.steps ?? 0,
      sqlQueries: over.sqlQueries ?? 0,
      created_at: over.created_at ?? new Date('2024-01-01'),
      updated_at: over.updated_at ?? new Date('2024-01-02'),
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
    const arr = docs;
    arr.limit = () => arr;
    return { sort: () => arr, select: () => arr };
  }
  function singleQuery(doc) {
    const q = {
      sort: () => q,
      then: (resolve) => resolve(doc),
    };
    return q;
  }

  const Thread = {
    create: vi.fn(async (d) => {
      const doc = threadDoc({ id: 't-new', ...d, connectionId: d.connectionId ? String(d.connectionId) : null });
      return doc;
    }),
    find: vi.fn(() => queryResult([])),
    findById: vi.fn(() => null),
    findOne: vi.fn(() => null),
    deleteOne: vi.fn(async () => ({ deletedCount: 0 })),
  };
  const Message = {
    create: vi.fn(async (d) => msgDoc({ ...d, id: 'm-new', threadId: String(d.threadId), userId: String(d.userId) })),
    find: vi.fn(() => queryResult([])),
    aggregate: vi.fn(async () => []),
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
  };
  const Investigation = {
    find: vi.fn(() => queryResult([])),
    findOne: vi.fn(() => null),
    countDocuments: vi.fn(async () => 0),
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
  };
  const Step = {
    find: vi.fn(() => queryResult([])),
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
  };
  return { Thread, Message, Investigation, Step, threadDoc, msgDoc, invDoc, stepDoc, queryResult, singleQuery };
});

vi.mock('../database/collections/index.js', () => ({
  Thread: fake.Thread,
  Message: fake.Message,
  Investigation: fake.Investigation,
  Step: fake.Step,
  User: {},
  GroqKey: {},
  Connection: {},
}));

const {
  generateThreadId,
  createThread,
  addMessage,
  getMessages,
  listThreads,
  getThread,
  getThreadRuns,
  getLatestRunSteps,
  hasActiveRun,
  getThreadContext,
  deleteThread,
} = await import('../database/thread-store.js');

describe('Thread Store (Mongoose)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.Thread.findById.mockReset();
    fake.Thread.findById.mockReturnValue(null);
    fake.Thread.findOne.mockReset();
    fake.Thread.findOne.mockReturnValue(fake.singleQuery(null));
    fake.Investigation.findOne.mockReset();
    fake.Investigation.findOne.mockReturnValue(fake.singleQuery(null));
  });

  describe('generateThreadId', () => {
    it('should generate a valid UUID', () => {
      expect(generateThreadId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('createThread', () => {
    it('should persist a thread with generated id and title', async () => {
      const { id, title } = await createThread('Why did orders drop?', { userId: 'user-1' });
      expect(id).toBeTruthy();
      expect(title).toBe('Why did orders drop?');
      expect(fake.Thread.create).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Why did orders drop?', userId: 'user-1', connectionId: null, database: null,
      }));
    });

    it('should store the database binding when provided', async () => {
      await createThread('Bound question', { connectionId: 'conn-1', database: 'sales_db', userId: 'user-1' });
      expect(fake.Thread.create).toHaveBeenCalledWith(expect.objectContaining({
        connectionId: 'conn-1', database: 'sales_db',
      }));
    });
  });

  describe('addMessage', () => {
    it('should insert message and touch thread updated_at', async () => {
      const thread = fake.threadDoc({ id: 't1', title: 'A', userId: 'user-1' });
      fake.Thread.findById.mockReturnValue(thread);

      await addMessage('t1', 'user', 'Hello');
      expect(fake.Thread.findById).toHaveBeenCalledWith('t1');
      expect(fake.Message.create).toHaveBeenCalledWith(expect.objectContaining({
        threadId: 't1', role: 'user', content: 'Hello', userId: 'user-1',
      }));
      expect(thread.save).toHaveBeenCalled();
    });

    it('should no-op when the thread does not exist', async () => {
      await addMessage('missing', 'user', 'Hi');
      expect(fake.Message.create).not.toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it('should return messages mapped to rows', async () => {
      fake.Message.find.mockReturnValue(fake.queryResult([
        fake.msgDoc({ id: 'm1', role: 'user', content: 'Hi', created_at: new Date('2024-01-01') }),
      ]));
      const result = await getMessages('t1');
      expect(fake.Message.find).toHaveBeenCalledWith({ threadId: 't1' });
      expect(result).toEqual([expect.objectContaining({ id: 'm1', role: 'user', content: 'Hi' })]);
    });
  });

  describe('listThreads', () => {
    it('should return thread rows with latest status and counts, scoped to the user', async () => {
      fake.Thread.find.mockReturnValue(fake.queryResult([
        fake.threadDoc({ id: 't1', title: 'A', updated_at: new Date('2024-01-02') }),
      ]));
      fake.Investigation.find.mockReturnValue(fake.queryResult([
        fake.invDoc({ id: 'i1', threadId: 't1', status: 'completed' }),
      ]));
      fake.Message.aggregate.mockResolvedValue([{ _id: { toString: () => 't1' }, count: 2 }]);

      const result = await listThreads('user-1');
      expect(fake.Thread.find).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(result[0]).toMatchObject({ id: 't1', title: 'A', latest_status: 'completed', message_count: 2 });
    });
  });

  describe('getThread', () => {
    it('should return null when thread does not exist', async () => {
      fake.Thread.findById.mockReturnValue(null);
      expect(await getThread('missing')).toBeNull();
    });

    it('should map the thread row when found', async () => {
      fake.Thread.findById.mockReturnValue(fake.threadDoc({ id: 't1', title: 'A', connectionId: 'c1', database: 'db' }));
      const row = await getThread('t1');
      expect(row).toMatchObject({ id: 't1', title: 'A', connection_id: 'c1', target_database: 'db' });
    });

    it('should scope lookups by owner when a userId is provided', async () => {
      fake.Thread.findOne.mockReturnValue(fake.singleQuery(fake.threadDoc({ id: 't1' })));
      await getThread('t1', 'user-1');
      expect(fake.Thread.findOne).toHaveBeenCalledWith({ _id: 't1', userId: 'user-1' });
    });
  });

  describe('getThreadRuns', () => {
    it('should map run summary rows ordered by start', async () => {
      fake.Investigation.find.mockReturnValue(fake.queryResult([
        fake.invDoc({ id: 'inv-1', question: 'Q', status: 'completed', finalAnswer: 'A', steps: 0, sqlQueries: 0, threadId: 't1' }),
      ]));
      const result = await getThreadRuns('t1');
      expect(fake.Investigation.find).toHaveBeenCalledWith({ threadId: 't1' });
      expect(result[0]).toMatchObject({ id: 'inv-1', question: 'Q', status: 'completed', final_answer: 'A' });
    });
  });

  describe('getLatestRunSteps', () => {
    it('should return steps for the most recent run', async () => {
      fake.Investigation.findOne.mockReturnValue(fake.singleQuery(fake.invDoc({ id: 'inv-latest', threadId: 't1' })));
      fake.Step.find.mockReturnValue(fake.queryResult([
        fake.stepDoc({ id: 's1', step_number: 1, tool_name: 'get_schema' }),
      ]));
      const result = await getLatestRunSteps('t1');
      expect(fake.Investigation.findOne).toHaveBeenCalledWith({ threadId: 't1' });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ step_number: 1, tool_name: 'get_schema' });
    });

    it('should return empty array when thread has no runs', async () => {
      fake.Investigation.findOne.mockReturnValue(fake.singleQuery(null));
      expect(await getLatestRunSteps('t-empty')).toEqual([]);
    });
  });

  describe('hasActiveRun', () => {
    it('should return true when a running investigation exists', async () => {
      fake.Investigation.countDocuments.mockResolvedValueOnce(1);
      expect(await hasActiveRun('t1')).toBe(true);
    });

    it('should return false when no running investigation exists', async () => {
      fake.Investigation.countDocuments.mockResolvedValueOnce(0);
      expect(await hasActiveRun('t1')).toBe(false);
    });
  });

  describe('getThreadContext', () => {
    it('should return last N completed answers in chronological order', async () => {
      fake.Investigation.find.mockReturnValue(fake.queryResult([
        fake.invDoc({ id: 'i3', question: 'Q3', finalAnswer: 'A3', status: 'completed', threadId: 't1' }),
        fake.invDoc({ id: 'i2', question: 'Q2', finalAnswer: 'A2', status: 'completed', threadId: 't1' }),
      ]));
      const result = await getThreadContext('t1', 2);
      expect(result).toEqual([
        { question: 'Q2', answer: 'A2' },
        { question: 'Q3', answer: 'A3' },
      ]);
      expect(fake.Investigation.find).toHaveBeenCalledWith({
        threadId: 't1', status: 'completed', finalAnswer: { $ne: null },
      });
    });

    it('should clamp non-numeric or out-of-range limits', async () => {
      fake.Investigation.find.mockReturnValue(fake.queryResult([]));
      await getThreadContext('t1', undefined);
      await getThreadContext('t1', 999);
      expect(fake.Investigation.find).toHaveBeenNthCalledWith(1, {
        threadId: 't1', status: 'completed', finalAnswer: { $ne: null },
      });
      expect(fake.Investigation.find).toHaveBeenNthCalledWith(2, {
        threadId: 't1', status: 'completed', finalAnswer: { $ne: null },
      });
    });

    it('should return empty array for thread without completed runs', async () => {
      fake.Investigation.find.mockReturnValue(fake.queryResult([]));
      expect(await getThreadContext('t-new', 3)).toEqual([]);
    });
  });

  describe('deleteThread', () => {
    it('should return false without deleting when thread does not exist', async () => {
      fake.Thread.findById.mockReturnValue(null);
      expect(await deleteThread('missing')).toBe(false);
      expect(fake.Step.deleteMany).not.toHaveBeenCalled();
    });

    it('should delete steps, investigations, messages, then the thread', async () => {
      fake.Thread.findById.mockReturnValue(fake.threadDoc({ id: 't1', title: 'A' }));
      fake.Investigation.find.mockReturnValue(fake.queryResult([fake.invDoc({ id: 'i1', threadId: 't1' })]));
      fake.Thread.deleteOne.mockResolvedValue({ deletedCount: 1 });

      expect(await deleteThread('t1')).toBe(true);
      expect(fake.Step.deleteMany).toHaveBeenCalled();
      expect(fake.Investigation.deleteMany).toHaveBeenCalledWith({ threadId: 't1' });
      expect(fake.Message.deleteMany).toHaveBeenCalledWith({ threadId: 't1' });
      expect(fake.Thread.deleteOne).toHaveBeenCalledWith({ _id: 't1' });
    });
  });
});
