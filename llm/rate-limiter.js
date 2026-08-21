import pino from 'pino';
import env from '../config/env.js';

const logger = pino({ name: 'rate-limiter' });

export class QueueTimeoutError extends Error {
  constructor(message, waitedMs) {
    super(message);
    this.name = 'QueueTimeoutError';
    this.waitedMs = waitedMs;
  }
}

export class RateLimiter {
  constructor({ maxConcurrent, queueTimeoutMs } = {}) {
    this.maxConcurrent = maxConcurrent ?? env.MAX_CONCURRENT_INVESTIGATIONS;
    this.queueTimeoutMs = queueTimeoutMs ?? env.INVESTIGATION_QUEUE_TIMEOUT_MS;
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }

    const enqueuedAt = Date.now();
    await new Promise((resolve, reject) => {
      const entry = {
        resolve: () => {
          if (entry.settled) return;
          entry.settled = true;
          clearTimeout(entry.timer);
          resolve();
        },
        timer: setTimeout(() => {
          if (entry.settled) return;
          entry.settled = true;
          const index = this.queue.indexOf(entry);
          if (index !== -1) this.queue.splice(index, 1);
          reject(new QueueTimeoutError(
            `Investigation queue is full; waited ${Date.now() - enqueuedAt}ms without a slot.`,
            Date.now() - enqueuedAt,
          ));
        }, this.queueTimeoutMs),
      };
      this.queue.push(entry);
    });
    this.active++;
  }

  release() {
    if (this.active === 0) return;
    this.active--;
    const next = this.queue.shift();
    if (next) {
      logger.debug({ queuedWaiters: this.queue.length }, 'Granting queued slot');
      next.resolve();
    }
  }

  get stats() {
    return { active: this.active, queued: this.queue.length, maxConcurrent: this.maxConcurrent };
  }
}

export const investigationRateLimiter = new RateLimiter();
