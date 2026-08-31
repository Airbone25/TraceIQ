import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunInvestigation, mockAcquire, mockRelease, mockFinalize, mockAddMessage, mockGetThread } = vi.hoisted(() => ({
  mockRunInvestigation: vi.fn(),
  mockAcquire: vi.fn(),
  mockRelease: vi.fn(),
  mockFinalize: vi.fn().mockResolvedValue(undefined),
  mockAddMessage: vi.fn().mockResolvedValue(undefined),
  mockGetThread: vi.fn().mockResolvedValue({ id: 'thread-1', title: 'T' }),
}));

vi.mock('../agent/agent.js', () => ({
  runInvestigation: mockRunInvestigation,
}));

vi.mock('../llm/rate-limiter.js', () => ({
  investigationRateLimiter: { acquire: mockAcquire, release: mockRelease },
}));

vi.mock('../database/investigation-store.js', () => ({
  finalizeInvestigation: mockFinalize,
}));

vi.mock('../database/thread-store.js', () => ({
  addMessage: mockAddMessage,
  getThread: mockGetThread,
}));

import { startJob, isJobActive, activeJobCount, cancelJob } from '../services/job-runner.js';

function completedResult(answer = 'Found the root cause.') {
  return {
    investigationId: 'inv-1',
    status: 'completed',
    answer,
    steps: 3,
    sqlQueries: 2,
  };
}

describe('Job Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
    mockRunInvestigation.mockResolvedValue(completedResult());
  });

  it('should run the job and persist assistant message for thread runs', async () => {
    await startJob({ investigationId: 'inv-1', question: 'Why?', threadId: 'thread-1' });

    expect(mockRunInvestigation).toHaveBeenCalledWith('Why?', { investigationId: 'inv-1', threadId: 'thread-1', threadContext: [], connectionId: null, database: null, shouldCancel: expect.any(Function) });
    expect(mockAddMessage).toHaveBeenCalledWith('thread-1', 'assistant', 'Found the root cause.');
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(isJobActive('inv-1')).toBe(false);
  });

  it('should not persist assistant message without a threadId', async () => {
    await startJob({ investigationId: 'inv-2', question: 'Standalone?' });

    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it('should not persist assistant message when run fails', async () => {
    mockRunInvestigation.mockResolvedValue({ ...completedResult(), status: 'failed', answer: null });

    await startJob({ investigationId: 'inv-3', question: 'Fails?', threadId: 'thread-3' });

    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('should skip assistant message when thread was deleted during the run', async () => {
    mockGetThread.mockResolvedValue(null);

    await startJob({ investigationId: 'inv-9', question: 'Deleted mid-run?', threadId: 'thread-9' });

    expect(mockGetThread).toHaveBeenCalledWith('thread-9');
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it('should not persist assistant message when completed answer is empty', async () => {
    mockRunInvestigation.mockResolvedValue({ ...completedResult(), answer: null });

    await startJob({ investigationId: 'inv-4', question: 'Empty?', threadId: 'thread-4' });

    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it('should pass threadContext through to the agent', async () => {
    const context = [{ question: 'Earlier?', answer: 'Earlier finding.' }];
    await startJob({ investigationId: 'inv-5', question: 'Follow-up?', threadId: 'thread-5', threadContext: context });

    expect(mockRunInvestigation).toHaveBeenCalledWith('Follow-up?', {
      investigationId: 'inv-5',
      threadId: 'thread-5',
      threadContext: context,
      connectionId: null,
      database: null,
      shouldCancel: expect.any(Function),
    });
  });

  it('should finalize as failed when queue times out', async () => {
    mockAcquire.mockRejectedValue(Object.assign(new Error('queue full'), { waitedMs: 10000 }));

    const result = await startJob({ investigationId: 'inv-6', question: 'Queued?', threadId: 'thread-6' });

    expect(result.status).toBe('failed');
    expect(mockRunInvestigation).not.toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalledWith('inv-6', expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('Queued too long'),
    }));
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it('should survive agent throwing unexpectedly (e.g. RateLimitError)', async () => {
    mockRunInvestigation.mockRejectedValue(new Error('Rate limit exceeded'));

    await startJob({ investigationId: 'inv-7', question: 'Throws?', threadId: 'thread-7' });
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(isJobActive('inv-7')).toBe(false);
  });

  it('should track active jobs and clean up when done', async () => {
    let resolveRun;
    mockRunInvestigation.mockReturnValue(new Promise(resolve => { resolveRun = resolve; }));

    const promise = startJob({ investigationId: 'inv-8', question: 'Slow?' });
    expect(isJobActive('inv-8')).toBe(true);
    expect(activeJobCount()).toBe(1);

    resolveRun(completedResult('Done.'));
    await promise;
    await new Promise(resolve => setImmediate(resolve));

    expect(isJobActive('inv-8')).toBe(false);
    expect(activeJobCount()).toBe(0);
  });

  it('should expose a cancel flag that flips when cancelJob is called', async () => {
    let resolveRun;
    let capturedShouldCancel;
    mockRunInvestigation.mockImplementation((question, opts) => {
      capturedShouldCancel = opts.shouldCancel;
      return new Promise(resolve => { resolveRun = resolve; });
    });

    const promise = startJob({ investigationId: 'inv-cancel', question: 'Cancel me?' });
    await new Promise(resolve => setImmediate(resolve));
    expect(typeof capturedShouldCancel).toBe('function');
    expect(capturedShouldCancel()).toBe(false);

    expect(cancelJob('inv-cancel')).toBe(true);
    expect(cancelJob('inv-cancel')).toBe(true); // idempotent
    expect(capturedShouldCancel()).toBe(true);

    resolveRun({ investigationId: 'inv-cancel', status: 'cancelled' });
    await promise;
    await new Promise(resolve => setImmediate(resolve));
    expect(isJobActive('inv-cancel')).toBe(false);
  });

  it('should be a no-op for unknown or inactive ids', async () => {
    expect(cancelJob('inv-unknown')).toBe(false);
  });

  it('should finalize as cancelled when cancelled before the run starts', async () => {
    // Defer rate-limiter acquisition so the job is parked before running.
    let releaseAcquire;
    mockAcquire.mockReturnValue(new Promise(resolve => { releaseAcquire = resolve; }));

    const promise = startJob({ investigationId: 'inv-pre', question: 'Q?', threadId: 'thread-pre' });
    expect(cancelJob('inv-pre')).toBe(true);

    releaseAcquire();
    const result = await promise;
    await new Promise(resolve => setImmediate(resolve));

    expect(result.status).toBe('cancelled');
    expect(mockRunInvestigation).not.toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalledWith('inv-pre', expect.objectContaining({ status: 'cancelled' }));
    expect(isJobActive('inv-pre')).toBe(false);
  });
});
