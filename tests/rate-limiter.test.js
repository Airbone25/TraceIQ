import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, QueueTimeoutError } from '../llm/rate-limiter.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should allow up to maxConcurrent immediate acquires', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, queueTimeoutMs: 100 });

    await limiter.acquire();
    await limiter.acquire();

    expect(limiter.stats.active).toBe(2);
    expect(limiter.stats.queued).toBe(0);
  });

  it('should queue requests beyond maxConcurrent and grant on release', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, queueTimeoutMs: 1000 });

    await limiter.acquire();
    const queued = limiter.acquire();
    await sleep(10);
    expect(limiter.stats.queued).toBe(1);

    limiter.release();
    await queued;

    expect(limiter.stats.active).toBe(1);
    expect(limiter.stats.queued).toBe(0);
  });

  it('should grant slots in FIFO order', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, queueTimeoutMs: 1000 });
    const order = [];

    await limiter.acquire();
    const first = limiter.acquire().then(() => order.push('first'));
    const second = limiter.acquire().then(() => order.push('second'));
    await sleep(10);

    limiter.release();
    await sleep(10);
    limiter.release();
    await Promise.all([first, second]);

    expect(order).toEqual(['first', 'second']);
  });

  it('should reject queued requests after the queue timeout', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, queueTimeoutMs: 30 });

    await limiter.acquire();
    const queued = limiter.acquire();

    await expect(queued).rejects.toBeInstanceOf(QueueTimeoutError);
    expect(limiter.stats.queued).toBe(0);
    expect(limiter.stats.active).toBe(1);
  });

  it('should include waitedMs in QueueTimeoutError', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, queueTimeoutMs: 20 });

    await limiter.acquire();
    const queued = limiter.acquire();

    try {
      await queued;
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.waitedMs).toBeGreaterThanOrEqual(15);
      expect(err.message).toMatch(/queue is full/i);
    }
  });

  it('should not count timed-out waiters when a slot later frees', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, queueTimeoutMs: 20 });

    await limiter.acquire();
    const timedOut = limiter.acquire().catch(() => 'timeout');
    await sleep(40);
    expect(await timedOut).toBe('timeout');

    limiter.release();
    await sleep(5);

    expect(limiter.stats.active).toBe(0);
    expect(limiter.stats.queued).toBe(0);

    await limiter.acquire();
    expect(limiter.stats.active).toBe(1);
  });

  it('should ignore release without a matching acquire', () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, queueTimeoutMs: 100 });

    limiter.release();
    limiter.release();

    expect(limiter.stats.active).toBe(0);
  });

  it('should support sequential reuse of slots', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, queueTimeoutMs: 100 });

    for (let i = 0; i < 3; i++) {
      await limiter.acquire();
      expect(limiter.stats.active).toBe(1);
      limiter.release();
      expect(limiter.stats.active).toBe(0);
    }
  });

  it('should fall back to env defaults when no options given', () => {
    const limiter = new RateLimiter();
    expect(limiter.maxConcurrent).toBeGreaterThan(0);
    expect(limiter.queueTimeoutMs).toBeGreaterThan(0);
  });
});
