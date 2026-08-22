import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../database/mysql.js', () => ({
  query: mockQuery,
}));

const { generateId, createInvestigation, addStep, finalizeInvestigation, getInvestigation, listInvestigations } = await import('../database/investigation-store.js');

describe('Investigation Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateId', () => {
    it('should generate a valid UUID', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('createInvestigation', () => {
    it('should create an investigation with running status', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const { id, startedAt } = await createInvestigation('test question');
      expect(id).toBeTruthy();
      expect(startedAt).toBeInstanceOf(Date);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO investigations'),
        [id, null, null, 'test question', 'running', startedAt]
      );
    });

    it('should persist a threadId when provided', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const { id } = await createInvestigation('threaded question', 'thread-9');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO investigations'),
        [id, 'thread-9', null, 'threaded question', 'running', expect.any(Date)]
      );
    });

    it('should return a UUID format id', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const { id } = await createInvestigation('test');
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('addStep', () => {
    it('should insert a step with correct parameters', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await addStep('inv-123', 1, 'execute_sql', { sql: 'SELECT 1' }, { rows: [1] }, 50);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO investigation_steps'),
        ['inv-123', 1, 'execute_sql', JSON.stringify({ sql: 'SELECT 1' }), JSON.stringify({ rows: [1] }), 50]
      );
    });

    it('should handle null inputs gracefully', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await addStep('inv-123', 0, 'get_schema', null, null, 0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO investigation_steps'),
        ['inv-123', 0, 'get_schema', 'null', 'null', 0]
      );
    });
  });

  describe('finalizeInvestigation', () => {
    it('should update investigation with completed status', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await finalizeInvestigation('inv-123', {
        status: 'completed',
        answer: 'test answer',
        error: null,
        steps: 5,
        sqlQueries: 3,
        durationMs: 12345,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE investigations SET'),
        ['completed', 'test answer', null, 5, 3, 12345, 'inv-123']
      );
    });

    it('should update investigation with failed status and error', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await finalizeInvestigation('inv-123', {
        status: 'failed',
        answer: null,
        error: 'API key invalid',
        steps: 2,
        sqlQueries: 1,
        durationMs: 5000,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE investigations SET'),
        ['failed', null, 'API key invalid', 2, 1, 5000, 'inv-123']
      );
    });
  });

  describe('getInvestigation', () => {
    it('should return null for non-existent investigation', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await getInvestigation('non-existent');
      expect(result).toBeNull();
    });

    it('should return investigation with steps', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'inv-123', question: 'test', status: 'completed' }])
        .mockResolvedValueOnce([{ step_number: 1, tool_name: 'get_schema' }]);
      const result = await getInvestigation('inv-123');
      expect(result).toBeTruthy();
      expect(result.id).toBe('inv-123');
      expect(result.steps).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should return empty steps array when no steps exist', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'inv-456', question: 'test', status: 'running' }])
        .mockResolvedValueOnce([]);
      const result = await getInvestigation('inv-456');
      expect(result.steps).toEqual([]);
    });
  });

  describe('listInvestigations', () => {
    it('should return all investigations', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'inv-1', question: 'q1' },
        { id: 'inv-2', question: 'q2' },
      ]);
      const result = await listInvestigations();
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no investigations exist', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await listInvestigations();
      expect(result).toEqual([]);
    });
  });
});
