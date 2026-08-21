import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../database/mysql.js', () => ({
  query: mockQuery,
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
} = await import('../database/thread-store.js');

describe('Thread Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
  });

  describe('generateThreadId', () => {
    it('should generate a valid UUID', () => {
      expect(generateThreadId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('createThread', () => {
    it('should insert a thread with generated id and title', async () => {
      const { id, title } = await createThread('Why did orders drop?');
      expect(id).toBeTruthy();
      expect(title).toBe('Why did orders drop?');
      expect(mockQuery).toHaveBeenCalledWith(
        'INSERT INTO investigation_threads (id, title) VALUES (?, ?)',
        [id, 'Why did orders drop?']
      );
    });
  });

  describe('addMessage', () => {
    it('should insert message and touch thread updated_at', async () => {
      await addMessage('thread-1', 'user', 'Hello');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        'INSERT INTO investigation_messages (thread_id, role, content) VALUES (?, ?, ?)',
        ['thread-1', 'user', 'Hello']
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'UPDATE investigation_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['thread-1']
      );
    });
  });

  describe('getMessages', () => {
    it('should return messages ordered chronologically', async () => {
      const messages = [{ id: 1, role: 'user', content: 'Hi' }];
      mockQuery.mockResolvedValueOnce(messages);
      const result = await getMessages('thread-1');
      expect(result).toEqual(messages);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at ASC, id ASC'), ['thread-1']);
    });
  });

  describe('listThreads', () => {
    it('should return thread rows with latest status and counts', async () => {
      const rows = [{ id: 't1', title: 'A', latest_status: 'completed', message_count: 2 }];
      mockQuery.mockResolvedValueOnce(rows);
      const result = await listThreads();
      expect(result).toEqual(rows);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY t.updated_at DESC'));
    });
  });

  describe('getThread', () => {
    it('should return null when thread does not exist', async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await getThread('missing')).toBeNull();
    });

    it('should return the thread row', async () => {
      const row = { id: 't1', title: 'A' };
      mockQuery.mockResolvedValueOnce([row]);
      expect(await getThread('t1')).toEqual(row);
    });
  });

  describe('getThreadRuns', () => {
    it('should select run summary columns ordered by start', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'inv-1' }]);
      await getThreadRuns('t1');
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM investigations WHERE thread_id = ?'), ['t1']);
      expect(mockQuery.mock.calls[0][0]).toContain('final_answer');
    });
  });

  describe('getLatestRunSteps', () => {
    it('should return steps for the most recent run', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'inv-latest' }])
        .mockResolvedValueOnce([{ step_number: 1, tool_name: 'get_schema' }]);
      const result = await getLatestRunSteps('t1');
      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('LIMIT 1'), ['t1']);
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('investigation_id = ?'), ['inv-latest']);
    });

    it('should return empty array when thread has no runs', async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await getLatestRunSteps('t-empty')).toEqual([]);
    });
  });

  describe('hasActiveRun', () => {
    it('should return true when a running investigation exists', async () => {
      mockQuery.mockResolvedValueOnce([{ cnt: 1 }]);
      expect(await hasActiveRun('t1')).toBe(true);
    });

    it('should return false when no running investigation exists', async () => {
      mockQuery.mockResolvedValueOnce([{ cnt: 0 }]);
      expect(await hasActiveRun('t1')).toBe(false);
    });
  });

  describe('getThreadContext', () => {
    it('should return last N completed answers in chronological order', async () => {
      mockQuery.mockResolvedValueOnce([
        { question: 'Q3', final_answer: 'A3' },
        { question: 'Q2', final_answer: 'A2' },
      ]);
      const result = await getThreadContext('t1', 2);
      expect(result).toEqual([
        { question: 'Q2', answer: 'A2' },
        { question: 'Q3', answer: 'A3' },
      ]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 2'),
        ['t1']
      );
    });

    it('should inline a sanitized integer LIMIT (regression: prepared statements reject LIMIT ?)', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await getThreadContext('t1', 3);
      expect(mockQuery.mock.calls[0][0]).toMatch(/LIMIT \d+$/);
      expect(mockQuery.mock.calls[0][0]).not.toContain('LIMIT ?');
      expect(mockQuery.mock.calls[0][1]).toEqual(['t1']);
    });

    it('should clamp non-numeric or out-of-range limits', async () => {
      mockQuery.mockResolvedValue([]);
      await getThreadContext('t1', undefined);
      await getThreadContext('t1', 999);
      const sqls = mockQuery.mock.calls.map(c => c[0]);
      expect(sqls[0]).toContain('LIMIT 1');
      expect(sqls[1]).toContain('LIMIT 50');
    });

    it('should return empty array for thread without completed runs', async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await getThreadContext('t-new', 3)).toEqual([]);
    });
  });
});
